#include <gtest/gtest.h>
#include "extractor.hpp"
#include <uhdm/uhdm.h>
#include <uhdm/Serializer.h>
#include <cstdlib>
#include <fstream>
#include <filesystem>

TEST(ExtractorTest, BasicJsonStructure) {
    nlohmann::json j;
    j["test"] = 1;
    EXPECT_EQ(j["test"], 1);
}

TEST(ExtractorTest, BusBreakoutOutputsExpectedNodes) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_uhdm_dir/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/bus_breakout.sv";

        const std::string command = "surelog -parse -sverilog " + fixture_path.string() + " -o test_uhdm_dir";
        int ret = std::system(command.c_str());
        if (ret != 0 || !fs::exists(uhdm_path)) {
            GTEST_SKIP() << "Surelog not available or failed";
        }
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    vpiHandle design = restoredDesigns[0];
    svsch::DesignExtractor extractor(design);
    nlohmann::json result = extractor.extract();

    ASSERT_TRUE(result.contains("modules"));

    const nlohmann::json* bus_breakout = nullptr;
    for (const auto& mod : result["modules"]) {
        if (mod["name"] == "bus_breakout") {
            bus_breakout = &mod;
            break;
        }
    }
    ASSERT_NE(bus_breakout, nullptr) << result.dump(2);

    EXPECT_EQ(result["rootModules"], nlohmann::json::array({"bus_breakout"}));

    // collapseAliasCombNodes removes the [alias] comb wire-rename nodes and
    // creates direct bus-tap → module-output-port edges instead.
    bool found_bus_node = false;
    bool found_edge_bus_to_a = false;
    bool found_edge_bus_to_b = false;

    for (const auto& node : (*bus_breakout)["nodes"]) {
        if (node["id"] == "bus:bus_breakout:bus_in") {
            found_bus_node = true;
            EXPECT_EQ(node["kind"], "bus");
            bool has_tap0 = false, has_tap1 = false, has_input = false;
            for (const auto& port : node["ports"]) {
                if (port["name"] == "[0]" && port["direction"] == "output") has_tap0 = true;
                if (port["name"] == "[1]" && port["direction"] == "output") has_tap1 = true;
                if (port["name"] == "bus_in" && port["direction"] == "input") has_input = true;
            }
            EXPECT_TRUE(has_tap0);
            EXPECT_TRUE(has_tap1);
            EXPECT_TRUE(has_input);
        }
        // Alias combs are collapsed; they should NOT appear as nodes.
        EXPECT_NE(node["id"], "comb:bus_breakout:a:alias");
        EXPECT_NE(node["id"], "comb:bus_breakout:b:alias");
    }

    for (const auto& edge : (*bus_breakout)["edges"]) {
        // After alias collapse: bus taps wire directly to module output ports.
        if (edge["source"] == "bus:bus_breakout:bus_in" && edge["target"] == "self" &&
            edge["sourcePort"] == "[0]" && edge["targetPort"] == "a") {
            found_edge_bus_to_a = true;
        }
        if (edge["source"] == "bus:bus_breakout:bus_in" && edge["target"] == "self" &&
            edge["sourcePort"] == "[1]" && edge["targetPort"] == "b") {
            found_edge_bus_to_b = true;
        }
    }

    EXPECT_TRUE(found_bus_node);
    EXPECT_TRUE(found_edge_bus_to_a);
    EXPECT_TRUE(found_edge_bus_to_b);
}

// A boundary `inout` port that is itself an unpacked array (e.g. `inout wire
// [7:0] a [0:1]`) is a hub: per-element muxes drive it on one side, and
// `assign y = a;` reads the whole array back out on the other. Before the
// fix, the array-composition node that combines the per-element drives into
// the whole-array value ALSO paired directly with `y` (via the whole-array
// alias mechanism), producing a second edge that overlapped the one
// correctly routed through the boundary port.
TEST(ExtractorTest, InoutArrayAliasProducesSingleEdgeIntoReader) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_uhdm_dir_inout_array_alias/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/inout_array_alias.sv";

        const std::string command = "surelog -parse -sverilog " + fixture_path.string() + " -o test_uhdm_dir_inout_array_alias";
        int ret = std::system(command.c_str());
        if (ret != 0 || !fs::exists(uhdm_path)) {
            GTEST_SKIP() << "Surelog not available or failed";
        }
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    vpiHandle design = restoredDesigns[0];
    svsch::DesignExtractor extractor(design);
    nlohmann::json result = extractor.extract();

    ASSERT_TRUE(result.contains("modules"));

    const nlohmann::json* mod = nullptr;
    for (const auto& candidate : result["modules"]) {
        if (candidate["name"] == "inout_array_alias") {
            mod = &candidate;
            break;
        }
    }
    ASSERT_NE(mod, nullptr) << result.dump(2);

    int edges_into_y = 0;
    bool found_hub_to_y = false;
    bool found_bus_comp_to_y = false;
    for (const auto& edge : (*mod)["edges"]) {
        if (edge["target"] != "self" || edge["targetPort"] != "y") continue;
        edges_into_y += 1;
        if (edge["source"] == "self" && edge["sourcePort"] == "a") found_hub_to_y = true;
        if (edge["source"] == "bus_comp:inout_array_alias:a") found_bus_comp_to_y = true;
    }

    EXPECT_EQ(edges_into_y, 1) << result.dump(2);
    EXPECT_TRUE(found_hub_to_y);
    EXPECT_FALSE(found_bus_comp_to_y);
}

TEST(ExtractorTest, FunctionDeclarationAndCallProduceCallableIr) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_uhdm_dir_function_call/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/function_call.sv";

        const std::string command =
            "surelog -parse -sverilog " + fixture_path.string() + " -o test_uhdm_dir_function_call";
        int ret = std::system(command.c_str());
        if (ret != 0 || !fs::exists(uhdm_path)) {
            GTEST_SKIP() << "Surelog not available or failed";
        }
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    svsch::DesignExtractor extractor(restoredDesigns[0]);
    nlohmann::json result = extractor.extract();

    const nlohmann::json* mod = nullptr;
    for (const auto& candidate : result["modules"]) {
        if (candidate["name"] == "function_call") mod = &candidate;
    }
    ASSERT_NE(mod, nullptr) << result.dump(2);
    ASSERT_EQ((*mod)["nodes"].size(), 1);
    const auto& call = (*mod)["nodes"][0];
    EXPECT_EQ(call["kind"], "funcCall");
    EXPECT_EQ(call["functionName"], "foo");
    EXPECT_EQ(call["functionId"], "function_call.foo");
    ASSERT_EQ(call["ports"].size(), 3);
    EXPECT_EQ(call["ports"][0]["name"], "lhs");
    EXPECT_EQ(call["ports"][0]["width"], "[7:0]");
    EXPECT_EQ(call["ports"][1]["name"], "rhs");
    EXPECT_EQ(call["ports"][2]["direction"], "output");
    EXPECT_EQ(call["ports"][2]["width"], "[7:0]");

    ASSERT_TRUE(result.contains("functions"));
    const nlohmann::json* function = nullptr;
    for (const auto& candidate : result["functions"]) {
        if (candidate["name"] == "function_call.foo") function = &candidate;
    }
    ASSERT_NE(function, nullptr) << result.dump(2);
    EXPECT_EQ((*function)["parentModule"], "function_call");
    EXPECT_EQ((*function)["functionName"], "foo");
    ASSERT_EQ((*function)["ports"].size(), 3);
    EXPECT_EQ((*function)["ports"][0]["direction"], "input");
    EXPECT_EQ((*function)["ports"][2]["direction"], "output");
    EXPECT_EQ((*function)["ports"][2]["name"], "foo");
    EXPECT_EQ((*function)["ports"][2]["width"], "[7:0]");

    ASSERT_EQ((*function)["nodes"].size(), 1);
    const auto& body_node = (*function)["nodes"][0];
    EXPECT_EQ(body_node["kind"], "alu");
    EXPECT_EQ(body_node["operation"], "+");
    EXPECT_EQ(body_node["ports"][2]["width"], "[7:0]");
}

TEST(ExtractorTest, TaskDeclarationAndCallProduceCallableIr) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_uhdm_dir_task_call/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/task_call.sv";
        const std::string command =
            "surelog -parse -sverilog " + fixture_path.string() + " -o test_uhdm_dir_task_call";
        int ret = std::system(command.c_str());
        if (ret != 0 || !fs::exists(uhdm_path)) {
            GTEST_SKIP() << "Surelog not available or failed";
        }
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    svsch::DesignExtractor extractor(restoredDesigns[0]);
    nlohmann::json result = extractor.extract();

    const nlohmann::json* mod = nullptr;
    for (const auto& candidate : result["modules"]) {
        if (candidate["name"] == "task_call") mod = &candidate;
    }
    ASSERT_NE(mod, nullptr) << result.dump(2);
    auto call = std::find_if((*mod)["nodes"].begin(), (*mod)["nodes"].end(), [](const auto& node) {
        return node["kind"] == "taskCall";
    });
    ASSERT_NE(call, (*mod)["nodes"].end()) << result.dump(2);
    EXPECT_EQ((*call)["taskName"], "add_values");
    EXPECT_EQ((*call)["taskId"], "task_call.add_values");
    ASSERT_EQ((*call)["ports"].size(), 3);
    EXPECT_EQ((*call)["ports"][2]["direction"], "output");
    EXPECT_EQ((*call)["ports"][2]["signal"], "y");

    const nlohmann::json* task = nullptr;
    for (const auto& candidate : result["tasks"]) {
        if (candidate["name"] == "task_call.add_values") task = &candidate;
    }
    ASSERT_NE(task, nullptr) << result.dump(2);
    EXPECT_EQ((*task)["parentModule"], "task_call");
    EXPECT_EQ((*task)["taskName"], "add_values");
    ASSERT_EQ((*task)["nodes"].size(), 1);
    EXPECT_EQ((*task)["nodes"][0]["kind"], "alu");
    EXPECT_EQ((*task)["nodes"][0]["operation"], "+");
}

int main(int argc, char **argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
