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

TEST(ExtractorTest, ClockSignalNamesDisambiguatesReorderedAsyncSensitivityList) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_async_reorder_dir/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/async_reset_clock_reordered.sv";

        const std::string command = "surelog -parse -sverilog " + fixture_path.string() + " -o test_async_reorder_dir";
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
    extractor.clock_signal_names = {"tck"};
    extractor.reset_signal_names = {"rst"};
    nlohmann::json result = extractor.extract();

    ASSERT_TRUE(result.contains("modules"));

    const nlohmann::json* mod = nullptr;
    for (const auto& m : result["modules"]) {
        if (m["name"] == "async_reset_clock_reordered") {
            mod = &m;
            break;
        }
    }
    ASSERT_NE(mod, nullptr) << result.dump(2);

    const nlohmann::json* reg = nullptr;
    for (const auto& node : (*mod)["nodes"]) {
        if (node["kind"] == "register") {
            reg = &node;
            break;
        }
    }
    ASSERT_NE(reg, nullptr) << mod->dump(2);

    // "rst_n" is listed first in the sensitivity list, but only "tck" matches
    // the configured clock_signal_names -- without honoring that config the
    // extractor would (wrongly) pick "rst_n" as the clock via positional
    // fallback.
    EXPECT_EQ((*reg)["metadata"]["clockSignal"], "tck");
    EXPECT_EQ((*reg)["metadata"]["resetSignal"], "rst_n");
    EXPECT_EQ((*reg)["metadata"]["resetActiveLow"], true);
}

int main(int argc, char **argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}

