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
