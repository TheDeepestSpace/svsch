#include <fstream>
// Extracts the normalized bit-width from a signal name that embeds a slice at
// its tail, e.g. "foo[3:0]", "foo[2]", "foo[1:0]_next".  Returns "" when no
// such slice is present.
static std::string widthFromSignalSlice(const std::string& signal) {
    if (signal.empty()) return "";
    std::regex re(R"(\[(-?\d+)(?::(-?\d+))?\](?:_\w+)?$)");
    std::smatch m;
    if (!std::regex_search(signal, m, re)) return "";
    int hi = std::stoi(m[1].str());
    int lo = m[2].matched ? std::stoi(m[2].str()) : hi;
    int size = std::abs(hi - lo) + 1;
    return widthFromBitSize(size);
}

// Resolves the best available width for a signal, using (in order):
//   1. getDeclaredSignalWidth  (mod.ports + source-text fallback)
//   2. findNodeOutputWidth     (scan existing output ports)
//   3. fallback_width          (caller-supplied port.width)
//   4. "[0:0]"                 (1-bit minimum)
std::string DesignExtractor::resolveSignalWidth(
    const Module& mod, const std::string& signal, const std::string& fallback_width)
{
    std::string w = getDeclaredSignalWidth(mod, signal);
    if (w.empty()) w = findNodeOutputWidth(mod.nodes, signal);
    if (w.empty()) w = fallback_width;
    if (w.empty()) w = "[0:0]";
    return w;
}

void DesignExtractor::repairAggregateReplicationWidths(Module& mod) {
    for (auto& node : mod.nodes) {
        if (node.kind != "replicate") continue;
        if (node.metadata.repeatCount <= 0) continue;

        int body_size = 0;
        for (auto& port : node.ports) {
            if (port.direction != "input") continue;
            std::string w = resolveSignalWidth(mod, port.signal, port.width);
            // Propagate improved width back to the port (mirrors TS: if (declared) port.width = declared)
            if (!w.empty() && w != "[0:0]" && w != port.width) port.width = w;
            body_size += std::max(1, bitSizeFromWidth(w));
        }
        if (body_size <= 0) continue;

        std::string repeated_width = widthFromBitSize(body_size * node.metadata.repeatCount);
        for (auto& port : node.ports) {
            if (port.direction != "output") continue;
            if (bitSizeFromWidth(port.width) < bitSizeFromWidth(repeated_width)) {
                port.width = repeated_width;
            }
            for (auto& edge : mod.edges) {
                if (edge.source == node.id && edge.sourcePort == port.name) {
                    edge.width = port.width;
                }
            }
        }
    }
}

void DesignExtractor::pruneDuplicateAggregateInputDrivers(Module& mod, Node& aggregate_node) {
    // Group input ports (excluding rhs_pad) by their connected signal.
    std::map<std::string, std::vector<NodePort*>> inputs_by_signal;
    for (auto& port : aggregate_node.ports) {
        if (port.direction != "input" || port.name == "rhs_pad" || port.signal.empty()) continue;
        inputs_by_signal[port.signal].push_back(&port);
    }

    for (auto& [signal, ports] : inputs_by_signal) {
        if (ports.size() < 2) continue;

        // Collect all nodes that output this signal (excluding the aggregate node itself).
        std::vector<std::string> producer_ids;
        for (const auto& n : mod.nodes) {
            if (n.id == aggregate_node.id) continue;
            for (const auto& p : n.ports) {
                if (p.direction == "output" && p.signal == signal) {
                    producer_ids.push_back(n.id);
                    break;
                }
            }
        }
        if (producer_ids.size() < ports.size()) continue;

        // For each duplicate port at index i, keep only the edge from producer[i]; remove others.
        std::set<std::string> producer_id_set(producer_ids.begin(), producer_ids.end());
        for (size_t i = 0; i < ports.size(); ++i) {
            const std::string& port_name = ports[i]->name;
            const std::string& expected_producer = producer_ids[i];
            mod.edges.erase(
                std::remove_if(mod.edges.begin(), mod.edges.end(), [&](const Edge& e) {
                    return e.target == aggregate_node.id
                        && e.targetPort == port_name
                        && producer_id_set.count(e.source)
                        && e.source != expected_producer;
                }),
                mod.edges.end()
            );
        }
    }
}

void DesignExtractor::repairAggregateAssignmentBuses(Module& mod) {
    repairAggregateReplicationWidths(mod);

    // --- Repair [aggregate-compose] buses ---
    // Iterate by index since we may modify mod.nodes during cleanup.
    for (auto& node : mod.nodes) {
        if (node.kind != "bus" || node.metadata.expression != "[aggregate-compose]") continue;

        NodePort* output = nullptr;
        for (auto& port : node.ports) {
            if (port.direction == "output") { output = &port; break; }
        }
        int output_size = output ? bitSizeFromWidth(output->width) : 0;

        // Collect non-pad input ports and their widths.
        std::vector<NodePort*> rhs_inputs;
        for (auto& port : node.ports) {
            if (port.direction == "input" && port.name != "rhs_pad") rhs_inputs.push_back(&port);
        }

        std::vector<std::string> input_widths;
        int rhs_size = 0;
        for (auto* port : rhs_inputs) {
            std::string w = resolveSignalWidth(mod, port->signal, port->width);
            if (w.empty()) w = "[0:0]";
            input_widths.push_back(w);
            rhs_size += bitSizeFromWidth(w);
        }

        // Expand output width if rhs is wider.
        if (output && rhs_size > output_size) {
            output->width = widthFromBitSize(rhs_size);
            output_size = rhs_size;
        }

        int leading_pad_size = 0;
        if (rhs_size >= output_size) {
            // Remove pad port and its edges (and any now-orphaned pad literal nodes).
            std::vector<std::string> pad_port_names;
            for (const auto& port : node.ports) {
                if (port.direction == "input" && port.name == "rhs_pad") pad_port_names.push_back(port.name);
            }
            if (!pad_port_names.empty()) {
                std::set<std::string> pad_set(pad_port_names.begin(), pad_port_names.end());
                node.ports.erase(
                    std::remove_if(node.ports.begin(), node.ports.end(), [&](const NodePort& p) {
                        return pad_set.count(p.name);
                    }),
                    node.ports.end()
                );
                mod.edges.erase(
                    std::remove_if(mod.edges.begin(), mod.edges.end(), [&](const Edge& e) {
                        return e.target == node.id && pad_set.count(e.targetPort);
                    }),
                    mod.edges.end()
                );
                // Remove literal nodes that are now fully disconnected.
                std::set<std::string> live_in_edges;
                for (const auto& e : mod.edges) {
                    live_in_edges.insert(e.source);
                    live_in_edges.insert(e.target);
                }
                mod.nodes.erase(
                    std::remove_if(mod.nodes.begin(), mod.nodes.end(), [&](const Node& n) {
                        return n.kind == "literal" && !live_in_edges.count(n.id);
                    }),
                    mod.nodes.end()
                );
            }
            if (rhs_size == output_size && node.metadata.reason == "rhs padded to lhs width") {
                node.metadata.reason = "";
            }
        } else {
            // Keep/update pad port size and label.
            int pad_size = output_size - rhs_size;
            leading_pad_size = pad_size;
            node.metadata.reason = "rhs padded to lhs width";
            for (auto& port : node.ports) {
                if (port.direction == "input" && port.name == "rhs_pad" && pad_size > 0) {
                    port.width = widthFromBitSize(pad_size);
                    port.label = concatSliceLabel(output_size - 1, pad_size);
                }
            }
        }

        // Relabel slice input ports.
        int current_bit = std::max(0, output_size - leading_pad_size - 1);
        if (rhs_size > output_size) current_bit = rhs_size - 1;
        for (size_t i = 0; i < rhs_inputs.size(); ++i) {
            auto* port = rhs_inputs[i];
            const std::string& w = input_widths[i];
            int size = bitSizeFromWidth(w);
            port->width = w;
            port->label = concatSliceLabel(current_bit, size);
            current_bit -= size;
        }

        pruneDuplicateAggregateInputDrivers(mod, node);

        // Propagate port widths to incoming edges.
        for (auto& edge : mod.edges) {
            if (edge.target != node.id || edge.targetPort.empty()) continue;
            for (const auto& port : node.ports) {
                if (port.name == edge.targetPort && !port.width.empty()) {
                    edge.width = port.width;
                    break;
                }
            }
        }
    }

    // --- Repair [aggregate-breakout] buses ---
    for (auto& node : mod.nodes) {
        if (node.kind != "bus" || node.metadata.expression != "[aggregate-breakout]") continue;

        NodePort* input = nullptr;
        for (auto& port : node.ports) {
            if (port.direction == "input") { input = &port; break; }
        }

        std::vector<NodePort*> outputs;
        for (auto& port : node.ports) {
            if (port.direction == "output") outputs.push_back(&port);
        }

        std::vector<std::string> output_widths;
        int output_size = 0;
        for (auto* port : outputs) {
            // Try to infer width from the slice embedded in the signal name first
            // (e.g. "registered[1:0]_next" → "[1:0]"), then fall back to normal lookup.
            std::string w = widthFromSignalSlice(port->signal);
            if (w.empty()) w = resolveSignalWidth(mod, port->signal, port->width);
            if (w.empty()) w = "[0:0]";
            output_widths.push_back(w);
            output_size += bitSizeFromWidth(w);
        }

        if (input && output_size > bitSizeFromWidth(input->width)) {
            input->width = widthFromBitSize(output_size);
            for (auto& edge : mod.edges) {
                if (edge.target == node.id && edge.targetPort == input->name) {
                    edge.width = input->width;
                }
            }
        }

        int input_size = input ? bitSizeFromWidth(input->width) : 0;
        int current_bit = std::max(0, input_size - 1);
        for (size_t i = 0; i < outputs.size(); ++i) {
            auto* port = outputs[i];
            const std::string& w = output_widths[i];
            int size = bitSizeFromWidth(w);
            port->width = w;
            port->label = concatSliceLabel(current_bit, size);
            current_bit -= size;
        }
    }
}

// Collapse non-procedural [alias] comb nodes: a node with one input and one output
// that is only a wire rename. Replace every incoming×outgoing edge pair with a
// direct edge, then remove the node and its original edges.
void DesignExtractor::collapseAliasCombNodes(Module& mod) {
    bool changed = true;
    while (changed) {
        changed = false;
        for (size_t ni = 0; ni < mod.nodes.size(); ++ni) {
            const Node& node = mod.nodes[ni];
            if (node.kind != "comb" || node.metadata.expression != "[alias]" || node.metadata.isProcedural) continue;

            const NodePort* in_port  = nullptr;
            const NodePort* out_port = nullptr;
            for (const auto& p : node.ports) {
                if (p.direction == "input")  in_port  = &p;
                if (p.direction == "output") out_port = &p;
            }
            if (!in_port || !out_port) continue;

            // Copy edges by value BEFORE any push_back (which could reallocate the vector).
            std::vector<Edge> incoming_copy, outgoing_copy;
            for (const auto& e : mod.edges) {
                if (e.target == node.id && e.targetPort == in_port->name)  incoming_copy.push_back(e);
                if (e.source == node.id && e.sourcePort == out_port->name) outgoing_copy.push_back(e);
            }
            if (incoming_copy.empty()) continue;

            auto endpoint_generate_region = [&](const std::string& node_id) -> std::pair<std::string, std::string> {
                for (const auto& candidate : mod.nodes) {
                    if (candidate.id == node_id) {
                        return {candidate.metadata.generateRegionId, candidate.metadata.generateActiveState};
                    }
                }
                return {"", ""};
            };

            // Bypass: for each incoming×outgoing pair, create a direct edge.
            std::vector<Edge> new_edges;
            for (const auto& inc : incoming_copy) {
                for (const auto& outg : outgoing_copy) {
                    Edge ne;
                    ne.source     = inc.source;
                    ne.sourcePort = inc.sourcePort;
                    ne.target     = outg.target;
                    ne.targetPort = outg.targetPort;
                    ne.signal    = outg.signal.empty() ? inc.signal : outg.signal;
                    ne.width     = outg.width.empty()  ? inc.width  : outg.width;
                    auto source_region = endpoint_generate_region(inc.source);
                    auto target_region = endpoint_generate_region(outg.target);
                    if (!inc.generateRegionId.empty()) {
                        ne.generateRegionId = inc.generateRegionId;
                        ne.generateActiveState = inc.generateActiveState;
                    } else if (!source_region.first.empty()) {
                        ne.generateRegionId = source_region.first;
                        ne.generateActiveState = source_region.second;
                    } else if (!outg.generateRegionId.empty()) {
                        ne.generateRegionId = outg.generateRegionId;
                        ne.generateActiveState = outg.generateActiveState;
                    } else if (!target_region.first.empty()) {
                        ne.generateRegionId = target_region.first;
                        ne.generateActiveState = target_region.second;
                    }
                    // Do not inherit isStacked from the incoming edge: the output side
                    // of an alias determines whether the bypass is stacked (e.g. array
                    // breakout outputs are scalar even though the input is stacked).
                    new_edges.push_back(ne);
                }
            }

            // Remove original edges by matching source/target/port against copied values.
            auto is_original = [&](const Edge& e) {
                for (const auto& orig : incoming_copy) {
                    if (e.source == orig.source && e.target == orig.target &&
                        e.sourcePort == orig.sourcePort && e.targetPort == orig.targetPort) return true;
                }
                for (const auto& orig : outgoing_copy) {
                    if (e.source == orig.source && e.target == orig.target &&
                        e.sourcePort == orig.sourcePort && e.targetPort == orig.targetPort) return true;
                }
                return false;
            };
            mod.edges.erase(std::remove_if(mod.edges.begin(), mod.edges.end(), is_original), mod.edges.end());
            mod.edges.insert(mod.edges.end(), new_edges.begin(), new_edges.end());
            mod.nodes.erase(mod.nodes.begin() + ni);
            changed = true;
            break; // restart after any modification
        }
    }
}

// Create or find the interface field breakout bus for a given interface signal and field.
// Returns the node (creating it in mod.nodes if absent).
static Node& ensureInterfaceBreakoutBus(Module& mod,
    const std::string& field_name, const std::string& full_signal,
    const std::string& field_width, const std::string& tap_name,
    const std::string& tap_label)
{
    std::string bus_id = "bus:" + mod.name + ":" + field_name;
    for (auto& n : mod.nodes) {
        if (n.id == bus_id) {
            bool found_out = false;
            for (auto& p : n.ports) {
                if (p.direction == "output" && p.name == tap_name) {
                    found_out = true;
                    break;
                }
            }
            if (!found_out) {
                n.ports.push_back({tap_name, "output", full_signal, field_width, tap_label});
            }
            return n;
        }
    }
    Node bus;
    bus.id    = bus_id;
    bus.kind  = "bus";
    bus.label = field_name;
    bus.ports.push_back({field_name, "input",  full_signal, field_width, field_name});
    bus.ports.push_back({tap_name, "output", full_signal, field_width, tap_label});
    mod.nodes.push_back(bus);
    return mod.nodes.back();
}

// Reroute interface field access edges through breakout bus nodes, and remove
// redundant intermediate comb nodes (those that just tap a single field or slice).
// Mirrors the TS repairInterfaceAssignments pass, but also creates the breakout
// bus nodes so the TS version becomes a no-op.
void DesignExtractor::repairInterfaceAssignmentsC(Module& mod) {
    // Snapshot: process only original edges (not ones we add during this pass).
    const size_t n_orig = mod.edges.size();
    std::set<size_t>   edges_to_remove;
    std::set<std::string> nodes_to_remove;
    std::vector<Edge>  additions;

    for (size_t ei = 0; ei < n_orig; ++ei) {
        Edge& edge = mod.edges[ei];
        if (edge.signal.find('.') == std::string::npos) continue;

        // Source must be an interface node; target must be a comb node.
        const Node* src = nullptr;
        const Node* tgt = nullptr;
        for (const auto& n : mod.nodes) {
            if (n.id == edge.source) src = &n;
            if (n.id == edge.target) tgt = &n;
        }
        if (!src || (src->kind != "interface" && src->kind != "bus")) continue;
        if (!tgt || tgt->kind != "comb") continue;

        // Extract field name from signal (e.g. "bus.data[0]" → "data[0]").
        size_t dot = edge.signal.rfind('.');
        if (dot == std::string::npos) continue;

        // Copy all data needed from src and tgt BEFORE any push_back that
        // could reallocate mod.nodes (invalidating the raw pointers).
        std::string src_kind        = src->kind;
        std::string orig_target_id  = tgt->id;
        std::string orig_target_port = tgt->metadata.expression; // unused below but keep for clarity
        std::string expr            = tgt->metadata.expression;
        std::string field_width     = "[0:0]";
        for (const auto& p : src->ports) {
            if (p.name == edge.sourcePort && !p.width.empty() && p.width != "interface") {
                field_width = p.width;
                break;
            }
        }
        orig_target_port = edge.targetPort; // reset to actual targetPort

        // The comb's expression must match the signal (direct or slice).
        bool is_direct = (expr == edge.signal);
        bool is_slice  = false;
        if (!is_direct) {
            size_t br = edge.signal.find('[');
            std::string base = (br != std::string::npos) ? edge.signal.substr(0, br) : edge.signal;
            is_slice = (expr.find(base + "[") != std::string::npos);
        }
        if (!is_direct && !is_slice) continue;

        // Check if comb has other incoming edges (still using pre-push_back data).
        bool has_other_inputs = false;
        for (size_t ej = 0; ej < n_orig; ++ej) {
            if (ej != ei && mod.edges[ej].target == orig_target_id) {
                has_other_inputs = true; break;
            }
        }

        std::string tap_signal = edge.signal;

        bool is_redundant = !has_other_inputs && (
            expr == tap_signal ||
            (expr.size() > tap_signal.size() + 1
             && expr.compare(0, tap_signal.size() + 1, tap_signal + "[") == 0
             && expr.back() == ']')
        );

        if (is_redundant && expr.size() > tap_signal.size() && expr.compare(0, tap_signal.size(), tap_signal) == 0 && expr[tap_signal.size()] == '[') {
            tap_signal = expr;
        }

        std::string tap_name = tap_signal.substr(dot + 1);
        std::string field_name = tap_name;
        std::string tap_label = tap_name;
        {
            size_t br = field_name.find('[');
            if (br != std::string::npos) {
                field_name = field_name.substr(0, br);
                tap_label = tap_name.substr(br);
            }
        }
        if (field_name.empty()) continue;

        if (is_redundant && is_direct) {
            // Direct forwarding (e.g. assign downstream.data = upstream.data):
            // short-circuit — reroute downstream to come from the original source,
            // no breakout bus needed. Mirrors the TS no-breakout else-branch.
            for (size_t ej = 0; ej < n_orig; ++ej) {
                auto& de = mod.edges[ej];
                if (de.source == orig_target_id) {
                    de.source     = edge.source;
                    de.sourcePort = edge.sourcePort;
                    de.signal     = !expr.empty() ? expr : tap_signal;
                }
            }
            edges_to_remove.insert(ei);
            nodes_to_remove.insert(orig_target_id);
            continue;
        }

        // For slice/complex accesses: create the breakout bus. This may push_back
        // to mod.nodes, invalidating src and tgt — they must not be used after this.
        ensureInterfaceBreakoutBus(mod, field_name, edge.signal, field_width, tap_name, tap_label);
        std::string breakout_id = "bus:" + mod.name + ":" + field_name;

        // Redirect the current edge to target the breakout bus input.
        edge.target     = breakout_id;
        edge.targetPort = field_name;

        if (is_redundant) {
            // Reroute downstream edges (from comb output) to come from breakout output.
            for (size_t ej = 0; ej < n_orig; ++ej) {
                auto& de = mod.edges[ej];
                if (de.source == orig_target_id) {
                    de.source     = breakout_id;
                    de.sourcePort = tap_name;
                    de.signal     = !expr.empty() ? expr : tap_signal;
                }
            }
            nodes_to_remove.insert(orig_target_id);
        } else {
            // Non-redundant comb: add edge from breakout output to the comb.
            bool already = false;
            for (const auto& e : mod.edges) {
                if (e.source == breakout_id && e.sourcePort == tap_name &&
                    e.target == orig_target_id && e.targetPort == orig_target_port) {
                    already = true; break;
                }
            }
            if (!already) {
                Edge ne;
                ne.source     = breakout_id;
                ne.sourcePort = tap_name;
                ne.target     = orig_target_id;
                ne.targetPort = orig_target_port;
                ne.signal     = tap_signal;
                ne.width      = field_width;
                additions.push_back(ne);
            }
        }
    }

    // Apply edge and node removals, then add new edges.
    if (!edges_to_remove.empty() || !nodes_to_remove.empty()) {
        std::vector<Edge> kept;
        kept.reserve(mod.edges.size());
        for (size_t i = 0; i < mod.edges.size(); ++i) {
            const auto& e = mod.edges[i];
            if (edges_to_remove.count(i)) continue;
            if (nodes_to_remove.count(e.source) || nodes_to_remove.count(e.target)) continue;
            kept.push_back(e);
        }
        mod.edges = std::move(kept);
        if (!nodes_to_remove.empty()) {
            mod.nodes.erase(std::remove_if(mod.nodes.begin(), mod.nodes.end(),
                [&](const Node& n) { return nodes_to_remove.count(n.id); }), mod.nodes.end());
        }
    }
    mod.edges.insert(mod.edges.end(), additions.begin(), additions.end());
}

// Synthesize bus_comp:mod:base nodes for signals driven by multiple slice sub-nodes.
// Mirrors the TS transformToDesignGraph bus composition synthesis pass.
void DesignExtractor::synthesizeBusCompositionNodes(Module& mod) {
    // Build map: base_signal → [{node_id, port_name, slice, width}]
    struct SliceDriver { std::string nodeId, portName, slice, width; };
    std::map<std::string, std::vector<SliceDriver>> sliceDrivers;

    for (const auto& n : mod.nodes) {
        if (n.kind == "bus") continue;
        if (n.kind == "comb" && n.metadata.expression == "[alias]" && !n.metadata.isProcedural) continue;
        for (const auto& p : n.ports) {
            if (p.direction != "output" || p.signal.empty()) continue;
            size_t bracket = p.signal.find('[');
            if (bracket == std::string::npos) continue;
            std::string base  = p.signal.substr(0, bracket);
            std::string slice = p.signal.substr(bracket);
            sliceDrivers[base].push_back({n.id, p.name, slice, p.width});
        }
    }

    for (auto& [base, drivers] : sliceDrivers) {
        // Skip if something already drives the full base signal.
        bool has_full_driver =
            std::any_of(mod.ports.begin(), mod.ports.end(),
                [&](const Port& p){ return p.name == base && p.direction == "input"; })
            || std::any_of(mod.nodes.begin(), mod.nodes.end(), [&](const Node& n){
                return std::any_of(n.ports.begin(), n.ports.end(), [&](const NodePort& p){
                    return p.direction == "output" && p.signal == base;
                });
               });
        if (has_full_driver) continue;

        if (drivers.size() <= 1 &&
            !std::any_of(mod.ports.begin(), mod.ports.end(),
                [&](const Port& p){ return p.name == base; })) continue;

        // Check that there is a consumer of the full base signal.
        bool has_full_consumer =
            std::any_of(mod.nodes.begin(), mod.nodes.end(), [&](const Node& n){
                return std::any_of(n.ports.begin(), n.ports.end(), [&](const NodePort& p){
                    return p.direction == "input" && p.signal == base;
                });
               })
            || std::any_of(mod.ports.begin(), mod.ports.end(),
                [&](const Port& p){ return p.name == base && p.direction == "output"; });
        if (!has_full_consumer) continue;

        std::string comp_id = "bus_comp:" + mod.name + ":" + base;
        if (std::any_of(mod.nodes.begin(), mod.nodes.end(),
                [&](const Node& n){ return n.id == comp_id; })) continue;

        // Determine output port width.
        std::string out_width = resolveSignalWidth(mod, base, "[0:0]");

        Node comp;
        comp.id   = comp_id;
        comp.kind = "bus";
        comp.label = base;
        comp.metadata.expression = base;
        comp.ports.push_back({base, "output", base, out_width, base});

        // Add input ports and driver edges (deduplicate by slice).
        std::set<std::string> seen_slices;
        for (const auto& driver : drivers) {
            if (!seen_slices.insert(driver.slice).second) continue;
            std::string port_width = widthFromSignalSlice(driver.slice);
            if (port_width.empty()) port_width = driver.width;
            comp.ports.push_back({driver.slice, "input", base + driver.slice, port_width, driver.slice});

            Edge e;
            e.source     = driver.nodeId;
            e.sourcePort = driver.portName;
            e.target     = comp_id;
            e.targetPort = driver.slice;
            e.signal     = base + driver.slice;
            e.width      = port_width;
            mod.edges.push_back(e);
        }

        // Sort input ports: high bit first, output last.
        std::sort(comp.ports.begin(), comp.ports.end(), [](const NodePort& a, const NodePort& b) {
            if (a.direction == "output") return false;
            if (b.direction == "output") return true;
            std::smatch ma, mb;
            static const std::regex re(R"(\[(\d+))");
            bool ha = std::regex_search(a.name, ma, re);
            bool hb = std::regex_search(b.name, mb, re);
            if (ha && hb) return std::stoi(ma[1]) > std::stoi(mb[1]);
            return a.name > b.name;
        });

        mod.nodes.push_back(comp);

        // Edges from comp output to full-bus consumers (nodes).
        for (const auto& n : mod.nodes) {
            if (n.id == comp_id) continue;
            for (const auto& p : n.ports) {
                if (p.direction != "input" || p.signal != base) continue;
                Edge e;
                e.source     = comp_id;
                e.sourcePort = base;
                e.target     = n.id;
                e.targetPort = p.name;
                e.signal     = base;
                e.width      = out_width;
                mod.edges.push_back(e);
            }
        }
        // Edges from comp output to module output ports ("self").
        for (const auto& p : mod.ports) {
            if (p.direction != "output" || p.name != base) continue;
            Edge e;
            e.source     = comp_id;
            e.sourcePort = base;
            e.target     = "self";
            e.targetPort = base;
            e.signal     = base;
            e.width      = out_width;
            mod.edges.push_back(e);
        }

        // Remove old direct edges from slice drivers to full-bus consumers.
        std::set<std::string> driver_ids;
        for (const auto& d : drivers) driver_ids.insert(d.nodeId);
        mod.edges.erase(std::remove_if(mod.edges.begin(), mod.edges.end(),
            [&](const Edge& e) {
                return driver_ids.count(e.source) && e.target != comp_id
                    && (e.signal == base ||
                        (e.signal.size() > base.size() && e.signal.rfind(base, 0) == 0));
            }),
            mod.edges.end());
    }
}
