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

        if (std::system("surelog --version > /dev/null 2>&1") != 0) {
            GTEST_SKIP() << "Surelog not available";
        }

        const std::string command = "surelog -parse -sverilog " + fixture_path.string() + " -o test_async_reorder_dir";
        int ret = std::system(command.c_str());
        ASSERT_EQ(ret, 0) << "Surelog failed to parse fixture";
        ASSERT_TRUE(fs::exists(uhdm_path)) << "Surelog did not produce the expected UHDM output";
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    vpiHandle design = restoredDesigns[0];
    svsch::DesignExtractor extractor(design);
    extractor.clock_signal_names = {"tck"};
    extractor.reset_signal_names = {"clr"};
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

    // "clr_n" is listed first in the sensitivity list, but only "tck" matches
    // the configured clock_signal_names -- without honoring that config the
    // extractor would (wrongly) pick "clr_n" as the clock via positional
    // fallback. "clr_n" is also not a default reset name, so this only
    // matches because reset_signal_names is configured to {"clr"}.
    EXPECT_EQ((*reg)["metadata"]["clockSignal"], "tck");
    EXPECT_EQ((*reg)["metadata"]["resetSignal"], "clr_n");
    EXPECT_EQ((*reg)["metadata"]["resetActiveLow"], true);
}

TEST(ExtractorTest, SyncResetNestedNegationIsActiveLow) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_sync_reset_nested_negation_dir/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/sync_reset_nested_negation.sv";

        if (std::system("surelog --version > /dev/null 2>&1") != 0) {
            GTEST_SKIP() << "Surelog not available";
        }

        const std::string command = "surelog -parse -sverilog " + fixture_path.string() + " -o test_sync_reset_nested_negation_dir";
        int ret = std::system(command.c_str());
        ASSERT_EQ(ret, 0) << "Surelog failed to parse fixture";
        ASSERT_TRUE(fs::exists(uhdm_path)) << "Surelog did not produce the expected UHDM output";
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    vpiHandle design = restoredDesigns[0];
    svsch::DesignExtractor extractor(design);
    extractor.reset_signal_names = {"clr"};
    nlohmann::json result = extractor.extract();

    ASSERT_TRUE(result.contains("modules"));

    const nlohmann::json* mod = nullptr;
    for (const auto& m : result["modules"]) {
        if (m["name"] == "sync_reset_nested_negation") {
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

    // The reset condition is `enable && !custom_clr_n`: the configured reset
    // identifier is nested under a && operator rather than being the
    // condition's outer operator, so active-low detection must inspect the
    // subtree around the matched identifier, not just the outer op.
    EXPECT_EQ((*reg)["metadata"]["resetSignal"], "custom_clr_n");
    EXPECT_EQ((*reg)["metadata"]["resetActiveLow"], true);
}

TEST(ExtractorTest, SyncResetDoesNotFalsePositiveWhenNoConfiguredNameMatches) {
    namespace fs = std::filesystem;

    const fs::path uhdm_path = fs::path("test_sync_reset_unconfigured_dir/slpp_all/surelog.uhdm");
    if (!fs::exists(uhdm_path)) {
        const fs::path fixture_path = fs::path(__FILE__)
            .parent_path().parent_path().parent_path().parent_path().parent_path()
            / "test/fixtures/sync_reset_unconfigured_name.sv";

        if (std::system("surelog --version > /dev/null 2>&1") != 0) {
            GTEST_SKIP() << "Surelog not available";
        }

        const std::string command = "surelog -parse -sverilog " + fixture_path.string() + " -o test_sync_reset_unconfigured_dir";
        int ret = std::system(command.c_str());
        ASSERT_EQ(ret, 0) << "Surelog failed to parse fixture";
        ASSERT_TRUE(fs::exists(uhdm_path)) << "Surelog did not produce the expected UHDM output";
    }

    UHDM::Serializer serializer;
    std::vector<vpiHandle> restoredDesigns = serializer.Restore(uhdm_path.string());
    ASSERT_FALSE(restoredDesigns.empty());

    vpiHandle design = restoredDesigns[0];
    svsch::DesignExtractor extractor(design);
    // No configured name can match "clr_n" (e.g. an empty resetSignalNames
    // config). Unlike clock/reset disambiguation in an async sensitivity list
    // (where every identifier present is necessarily a clock or reset signal),
    // an if/else condition can be an arbitrary boolean, so falling back
    // positionally here would misclassify ordinary conditional register
    // updates (e.g. a plain mux select) as synchronous resets. The extractor
    // must not detect a sync reset in this case.
    extractor.reset_signal_names = {};
    nlohmann::json result = extractor.extract();

    ASSERT_TRUE(result.contains("modules"));

    const nlohmann::json* mod = nullptr;
    for (const auto& m : result["modules"]) {
        if (m["name"] == "sync_reset_unconfigured_name") {
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

    EXPECT_FALSE((*reg)["metadata"].contains("resetKind"));
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

int main(int argc, char **argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}

