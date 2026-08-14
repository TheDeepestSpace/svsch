void DesignExtractor::buildEdges(Module& mod) {
    // Collect stacked signals: outputs of isArrayNode nodes. Scalar controls can still
    // be promoted into stacked inputs when they target array-capable nodes.
    std::set<std::string> stacked_signals;
    for (const auto& n : mod.nodes) {
        if (!n.metadata.isArrayNode) continue;
        for (const auto& p : n.ports) {
            if (p.direction == "output") stacked_signals.insert(p.signal);
        }
    }

    std::map<std::string, std::vector<std::pair<std::string, std::string>>> signal_map;
    for (const auto& n : mod.nodes) {
        for (const auto& p : n.ports) {
            if (!p.signal.empty()) signal_map[p.signal].push_back({n.id, p.name});
        }
    }
    for (const auto& p : mod.ports) {
        if (!p.name.empty()) signal_map[p.name].push_back({"self", p.name});
    }
    auto endpoint_is_array = [&](const std::pair<std::string, std::string>& endpoint) {
        if (endpoint.first == "self") return mod.arrayDimensions.count(endpoint.second) > 0;
        for (const auto& n : mod.nodes) {
            if (n.id == endpoint.first) {
                if (n.kind == "bus" && n.metadata.aggregateKind == "array" && n.metadata.role == "composition") {
                    for (const auto& p : n.ports) {
                        if (p.name == endpoint.second && p.direction == "input") return false;
                    }
                }
                return n.metadata.isArrayNode;
            }
        }
        return false;
    };
    auto has_array_alias = [&](const std::string& signal) {
        for (const auto& alias : mod.pendingArrayAliases) {
            if (alias.targetSignal != signal) continue;
            if (stacked_signals.count(alias.sourceSignal)) return true;
            if (mod.arrayDimensions.count(alias.sourceSignal) && mod.arrayDimensions.count(alias.targetSignal)) return true;
        }
        return false;
    };

    for (auto const& [signal, ports] : signal_map) {
        if (mod.interfaceSignals.count(signal)) continue;
        std::vector<std::pair<std::string, std::string>> drivers, loads;
        for (const auto& n : mod.nodes) {
            for (const auto& p : n.ports) {
                if (p.signal == signal) {
                    if (p.direction == "output") drivers.push_back({n.id, p.name});
                    else if (p.direction == "input") loads.push_back({n.id, p.name});
                    else if (p.direction == "inout") {
                        drivers.push_back({n.id, p.name});
                        loads.push_back({n.id, p.name});
                    }
                }
            }
        }
        for (const auto& p : mod.ports) {
            if (p.name == signal) {
                if (p.direction == "input") drivers.push_back({"self", p.name});
                else if (p.direction == "output") loads.push_back({"self", p.name});
                else if (p.direction == "inout") {
                    drivers.push_back({"self", p.name});
                    loads.push_back({"self", p.name});
                }
            }
        }

        for (const auto& alias : mod.pendingArrayAliases) {
            if (alias.targetSignal != signal) continue;
            for (const auto& n : mod.nodes) {
                for (const auto& p : n.ports) {
                    if (p.signal == alias.sourceSignal && (p.direction == "output" || p.direction == "inout")) {
                        drivers.push_back({n.id, p.name});
                    }
                }
            }
            for (const auto& p : mod.ports) {
                if (p.name == alias.sourceSignal && (p.direction == "input" || p.direction == "inout")) {
                    drivers.push_back({"self", p.name});
                }
            }
        }

        // An `inout` endpoint on this signal (pushed into both `drivers` and
        // `loads` above) is a hub: everything else driving the net drives
        // *into* it, and everything else reading the net reads *out of* it.
        // Without this, a real driver (e.g. a mux assigning an inout port)
        // and a real load (e.g. an `assign y = <the inout port>;`) would
        // also pair up directly, bypassing the inout endpoint and rendering
        // as a wire overlapping the one that correctly routes through it.
        std::set<std::pair<std::string, std::string>> hubs;
        {
            std::set<std::pair<std::string, std::string>> driverSet(drivers.begin(), drivers.end());
            for (const auto& l : loads) if (driverSet.count(l)) hubs.insert(l);
        }

        for (const auto& d : drivers) {
            std::string edge_width = "";
            if (d.first == "self") {
                for (const auto& p : mod.ports) if (p.name == d.second) {
                    edge_width = p.width;
                    break;
                }
            } else {
                for (const auto& n : mod.nodes) if (n.id == d.first) {
                    for (const auto& p : n.ports) if (p.name == d.second) {
                        edge_width = p.width;
                        break;
                    }
                    break;
                }
            }

            for (const auto& l : loads) {
                if (d.first == l.first && d.second == l.second) continue;
                if (!hubs.empty() && !hubs.count(d) && !hubs.count(l)) continue;
                Edge e; e.source = d.first; e.sourcePort = d.second; e.target = l.first; e.targetPort = l.second; e.signal = signal;
                e.width = edge_width;
                if (mod.interfaceSignals.count(signal)) {
                    e.aggregateKind = "interface";
                }
                if (mod.structSignals.count(signal)) {
                    e.aggregateKind = "struct";
                }

                // Mark stacked edges when either side participates in array transport. Scalar
                // signals entering an array node are promoted; array sources stay stacked until
                // a scalarizing consumer (such as the read mux output) emits a new scalar signal.
                auto is_array_composition = [&](const std::pair<std::string, std::string>& endpoint) {
                    if (endpoint.first == "self") return false;
                    for (const auto& n : mod.nodes) {
                        if (n.id == endpoint.first && n.kind == "bus" && n.metadata.aggregateKind == "array" && n.metadata.role == "composition") return true;
                    }
                    return false;
                };
                auto is_array_breakout = [&](const std::pair<std::string, std::string>& endpoint) {
                    if (endpoint.first == "self") return false;
                    for (const auto& n : mod.nodes) {
                        if (n.id == endpoint.first && n.kind == "bus" && n.metadata.aggregateKind == "array" && n.metadata.role != "composition") return true;
                    }
                    return false;
                };

                e.isStacked = stacked_signals.count(signal) > 0
                    || is_array_composition(d)
                    || is_array_breakout(l)
                    || has_array_alias(signal);

                bool duplicate = false;
                for (auto& existing : mod.edges) {
                    if (existing.source == e.source && existing.target == e.target &&
                        existing.sourcePort == e.sourcePort && existing.targetPort == e.targetPort &&
                        existing.signal == e.signal) { duplicate = true; break; }
                    // An `inout` endpoint is pushed into both `drivers` and `loads` above,
                    // so a signal shared by two inout ports produces this same pair twice,
                    // once in each direction — the same physical wire rendered as two
                    // overlapping edges. Collapse it to one, preferring the direction where
                    // the module boundary ("self") is the source, matching the convention
                    // already used for scalar ports (boundary drives inward into instances).
                    // Guarded on matching `signal` too: pendingArrayAliases can produce a
                    // reversed pair of edges between the same endpoints for two *different*
                    // signals (e.g. reciprocal aliases on a bus breakout), which must stay
                    // as two distinct edges rather than collapsing into one.
                    if (existing.source == e.target && existing.target == e.source &&
                        existing.sourcePort == e.targetPort && existing.targetPort == e.sourcePort &&
                        existing.signal == e.signal) {
                        if (e.source == "self" && existing.source != "self") {
                            existing = e;
                        }
                        duplicate = true;
                        break;
                    }
                }
                bool is_bus_selection_signal = (signal.find('[') != std::string::npos && signal.find(']') != std::string::npos);

                if (!duplicate) {
                    if (d.first == "self" && l.first == "self" && is_bus_selection_signal) {
                        // Skip creating edge for direct port-to-port connection if it's a bus selection signal
                        // This prevents extraneous direct connections as per test expectations.
                    } else {
                        mod.edges.push_back(e);
                    }
                }
            }
        }
    }

    removeUnconnectedLiteralNodes(mod);
    repairResolvedExplicitBusCompositions(mod);
    repairResolvedBusCompositionSlices(mod);
    repairAggregateAssignmentBuses(mod);
    collapseAliasCombNodes(mod);
    repairInterfaceAssignmentsC(mod);
    synthesizeBusCompositionNodes(mod);
    unifyNetPropagation(mod);
    markDeclaredNetEdges(mod);
}

// Fills in declaredNetName, for edges collapseAliasCombNodes didn't already
// give one, whenever `signal` itself is a name genuinely declared in the SV
// source (a port, or a wire/reg/variable) — as opposed to a tool-synthesized
// name such as a promoted expression temp ("foo_next", "foo_sel") or an
// aggregate/select label. Chain-collapsed edges keep the earliest-declared
// name collapseAliasCombNodes already chose, which may differ from `signal`.
void DesignExtractor::markDeclaredNetEdges(Module& mod) {
    auto baseName = [](const std::string& signal) {
        std::string base = signal;
        size_t bracket = base.find('[');
        if (bracket != std::string::npos) base = base.substr(0, bracket);
        size_t dot = base.find('.');
        if (dot != std::string::npos) base = base.substr(0, dot);
        return base;
    };
    // A port only names the module's boundary, not this net specifically, so
    // it doesn't count as a "declared name" here — matches the same rule
    // collapseAliasCombNodes applies via chooseAliasPrimary.
    auto isPort = [&](const std::string& name) {
        return std::any_of(mod.ports.begin(), mod.ports.end(), [&](const Port& p) { return p.name == name; });
    };
    for (auto& e : mod.edges) {
        if (!e.declaredNetName.empty() || e.signal.empty()) continue;
        std::string base = baseName(e.signal);
        // `signal` must be a bare declared identifier, not a compound
        // expression that merely starts with one (a bit-select "M[3]", a
        // field-select "pkt.valid", or a synthesized derived name like
        // "M[address]_next" for an array's write-candidate wire). The base
        // array/struct being declared doesn't mean this specific derived
        // expression names the net — labeling it with the base name would
        // misidentify a different net's value as this one's.
        if (e.signal == base && mod.internalSignals.count(base) && !isPort(base)) {
            e.declaredNetName = e.signal;
        }
    }
}

void DesignExtractor::unifyNetPropagation(Module& mod) {
    struct DriverInfo {
        std::string nodeId;
        std::string portId;
        std::string width;
    };
    std::map<std::string, DriverInfo> signalDrivers;

    // 1. Module input ports are drivers.
    for (const auto& p : mod.ports) {
        if (p.direction == "input" || p.direction == "inout") {
            signalDrivers[p.name] = {"self", p.name, p.width};
        }
    }

    // 2. Identify drivers for each signal from existing edges.
    // If an edge targets a module output port, its source is the driver for that port's signal.
    for (const auto& edge : mod.edges) {
        if (edge.target == "self") {
            for (const auto& p : mod.ports) {
                if (p.name == edge.targetPort && p.direction == "output") {
                    signalDrivers[p.name] = {edge.source, edge.sourcePort, edge.width};
                }
            }
        }
    }

    // 3. Also consider any edge as a potential driver for its signal if not already known.
    for (const auto& edge : mod.edges) {
        if (!edge.signal.empty() && signalDrivers.find(edge.signal) == signalDrivers.end()) {
             // If source is not "self" or it's an input port, it's a driver.
             bool source_is_output_port = false;
             if (edge.source == "self") {
                 for (const auto& p : mod.ports) {
                     if (p.name == edge.sourcePort && p.direction == "output") {
                         source_is_output_port = true;
                         break;
                     }
                 }
             }
             if (!source_is_output_port) {
                 signalDrivers[edge.signal] = {edge.source, edge.sourcePort, edge.width};
             }
        }
    }

    // 4. Re-route edges that incorrectly use an output port as a source.
    for (auto& edge : mod.edges) {
        if (edge.source == "self") {
            bool is_output = false;
            for (const auto& p : mod.ports) {
                if (p.name == edge.sourcePort && p.direction == "output") {
                    is_output = true;
                    break;
                }
            }

            if (is_output) {
                auto it = signalDrivers.find(edge.sourcePort);
                if (it != signalDrivers.end() && it->second.nodeId != "self") {
                    edge.source = it->second.nodeId;
                    edge.sourcePort = it->second.portId;
                }
            }
        }
    }

    // 5. Handle "floating" nodes (bus, struct, select, replicate) with signal matching.
    for (const auto& node : mod.nodes) {
        if (node.kind != "bus" && node.kind != "struct" && node.kind != "select" && node.kind != "replicate") continue;
        for (const auto& port : node.ports) {
            if (port.direction != "input" || port.signal.empty()) continue;

            bool has_incoming = false;
            for (const auto& e : mod.edges) {
                if (e.target == node.id && e.targetPort == port.name) {
                    has_incoming = true;
                    break;
                }
            }

            if (!has_incoming) {
                auto it = signalDrivers.find(port.signal);
                if (it != signalDrivers.end()) {
                    Edge e;
                    e.source = it->second.nodeId;
                    e.sourcePort = it->second.portId;
                    e.target = node.id;
                    e.targetPort = port.name;
                    e.signal = port.signal;
                    e.width = it->second.width.empty() ? port.width : it->second.width;
                    mod.edges.push_back(e);
                }
            }
        }
    }
}

std::string DesignExtractor::getSignalName(vpiHandle handle, const std::map<std::string, LoweredValue>& current_drivers) {
    std::string base_name = getSignalName(handle);
    if (current_drivers.count(base_name)) {
        return current_drivers.at(base_name).signal;
    }
    // Check if it's a part select/bit select and the base has a current driver
    std::string base = getBaseSignalName(handle);
    if (!base.empty() && base != base_name && current_drivers.count(base)) {
        return current_drivers.at(base).signal;
    }
    return base_name;
}

std::string DesignExtractor::getSignalName(vpiHandle handle) {
    if (!handle) return "";
    int type = vpi_get(vpiType, handle);

    if (type == 608) { // vpiRefObj
        vpiHandle actual = vpi_handle(vpiActual, handle);
        if (actual && actual != handle) return getSignalName(actual);
    }
    if (type == vpiOperation) {
        int op_type = vpi_get(vpiOpType, handle);
        if (op_type == 39 || op_type == 40) {
             vpiHandle operand_itr = vpi_iterate(vpiOperand, handle);
             if (operand_itr) {
                 vpiHandle op = vpi_scan(operand_itr);
                 std::string name = getSignalName(op);
                 vpi_release_handle(operand_itr);
                 return name;
             }
        }
        return "expr";
    }
    if (type == vpiBitSelect || type == vpiPartSelect || type == 606 || type == 607 || type == 130) {
        const char* d = vpi_get_str(vpiDecompile, handle);
        if (d && strlen(d) > 0 && strchr(d, '[')) {
            std::string s = d;
            if (s.rfind("work@", 0) == 0) s = s.substr(5);
            return s;
        }

        std::string base = getBaseSignalName(handle);

        if (!base.empty()) {
            vpiHandle left_h = vpi_handle(vpiLeftRange, handle);
            vpiHandle right_h = vpi_handle(vpiRightRange, handle);
            if (!left_h && (type == vpiBitSelect || type == 606 || type == 607 || type == 130)) left_h = vpi_handle(vpiIndex, handle);
            if (!left_h && (type == 606 || type == 607 || type == 130)) left_h = vpi_handle(vpiBaseExpr, handle);

            std::string l = left_h ? getExprText(left_h) : "";
            std::string r = right_h ? getExprText(right_h) : "";

            if (l.empty() || l == "const" || l == "?") {
                if (type == vpiBitSelect) {
                    int idx = vpi_get(vpiIndex, handle);
                    if (idx != vpiUndefined) l = std::to_string(idx);
                } else {
                    int lv = vpi_get(vpiLeftRange, handle);
                    if (lv != vpiUndefined) l = std::to_string(lv);
                }
            }
            if (r.empty() || r == "const" || r == "?") {
                if (type == 606 || type == 607 || type == 130) {
                    vpiHandle width_h = vpi_handle(vpiWidthExpr, handle);
                    if (width_h) r = getExprText(width_h);
                } else {
                    int rv = vpi_get(vpiRightRange, handle);
                    if (rv != vpiUndefined) r = std::to_string(rv);
                }
            }

            if (type == vpiBitSelect) {
                return base + "[" + (l.empty() || l == "?" ? "bit" : l) + "]";
            } else if (type == 606 || type == 607 || type == 130) {
                // Approximate representation if decompile fails
                return base + "[" + (l.empty() || l == "?" ? "idx" : l) + "+:" + (r.empty() || r == "?" ? "width" : r) + "]";
            } else {
                return base + "[" + (l.empty() || l == "?" ? "0" : l) + ":" + (r.empty() || r == "?" ? "0" : r) + "]";
            }
        } else {
            std::string name = vpi_get_str(vpiName, handle);
            if (name.empty()) name = vpi_get_str(vpiFullName, handle);
            if (name.empty()) name = "bus";
            return name;
        }
    }

    const char* name = vpi_get_str(vpiName, handle);
    const char* def_name = vpi_get_str(vpiDefName, handle);
    const char* full_name = vpi_get_str(vpiFullName, handle);

    if (!name || strlen(name) == 0) name = def_name;

    if (name && strlen(name) > 0) {
        std::string s = name;
        if (s.rfind("work@", 0) == 0) s = s.substr(5);
        return s;
    }

    if (type == vpiConstant) {
        const char* val = vpi_get_str(vpiDecompile, handle);
        if (val) return val;

        s_vpi_value value;
        value.format = vpiDecStrVal;
        vpi_get_value(handle, &value);
        if (value.format != vpiSuppressVal && value.value.str) {
            return value.value.str;
        }

        return "const";
    }
    return "";
}

std::string DesignExtractor::getBaseSignalName(vpiHandle handle) {
    if (!handle) return "";
    int type = vpi_get(vpiType, handle);

    if (type == vpiBitSelect || type == vpiPartSelect) {
        const char* name = vpi_get_str(vpiName, handle);
        if (name && strlen(name) > 0) {
            std::string s = name;
            if (s.rfind("work@", 0) == 0) s = s.substr(5);
            return s;
        }

        vpiHandle expr = vpi_handle(vpiExpr, handle);
        if (expr) return getBaseSignalName(expr);

        vpiHandle parent = vpi_handle(vpiParent, handle);
        if (parent && parent != handle && vpi_get(vpiType, parent) != vpiAssignment && vpi_get(vpiType, parent) != 84 && vpi_get(vpiType, parent) != 85 && vpi_get(vpiType, parent) != vpiModule && vpi_get(vpiType, parent) != vpiContAssign) {
            return getBaseSignalName(parent);
        }

        vpiHandle op_itr = vpi_iterate(vpiOperand, handle);
        if (op_itr) {
            vpiHandle op = vpi_scan(op_itr);
            vpi_release_handle(op_itr);
            if (op) return getBaseSignalName(op);
        }
    }

    if (type == 608) { // vpiRefObj
        vpiHandle actual = vpi_handle(vpiActual, handle);
        if (actual && actual != handle) return getBaseSignalName(actual);
    }

    const char* name = vpi_get_str(vpiName, handle);
    if (name && strlen(name) > 0) {
        std::string s = name;
        if (s.rfind("work@", 0) == 0) s = s.substr(5);
        return s;
    }
    return "";
}
// Extract width from a port/io_decl handle using the UHDM C++ object API.
// The VPI layer doesn't surface the typespec range via vpiTypespec or
// vpiLeftRange on port handles; the data lives at port::Typespec() instead.
static std::string widthFromPortTypespec(vpiHandle handle) {
    auto* h = reinterpret_cast<const uhdm_handle*>(handle);
    if (!h || !h->object) return "";
    const auto* port_obj = static_cast<const UHDM::ports*>(h->object);
    const UHDM::ref_typespec* ref_ts = port_obj->Typespec();
    if (!ref_ts) return "";
    const auto* lts = ref_ts->Actual_typespec<UHDM::logic_typespec>();
    if (!lts) return "";

    // Prefer Ranges() (packed range declarations like [3:0])
    if (const UHDM::VectorOfrange* ranges = lts->Ranges()) {
        if (!ranges->empty()) {
            const UHDM::range* r0 = (*ranges)[0];
            if (r0 && r0->Left_expr() && r0->Right_expr()) {
                std::string l = std::string(r0->Left_expr()->VpiDecompile());
                std::string r = std::string(r0->Right_expr()->VpiDecompile());
                if (!l.empty() && !r.empty() && (l != "0" || r != "0"))
                    return "[" + l + ":" + r + "]";
            }
        }
    }
    // Fallback: Left_expr/Right_expr directly on the typespec
    if (lts->Left_expr() && lts->Right_expr()) {
        std::string l = std::string(lts->Left_expr()->VpiDecompile());
        std::string r = std::string(lts->Right_expr()->VpiDecompile());
        if (!l.empty() && !r.empty() && (l != "0" || r != "0"))
            return "[" + l + ":" + r + "]";
    }
    return "";
}

// A net/reg reached through a ref-obj (e.g. an identifier used inside an
// expression like `sel_wide * 8`) doesn't carry its own populated typespec —
// only the module *port* declaration does (see widthFromPortTypespec above).
// Walk up to the enclosing module and look up the sibling port by name.
static std::string widthFromSiblingPort(vpiHandle net_handle) {
    const char* raw_name = vpi_get_str(vpiName, net_handle);
    if (!raw_name) return "";
    std::string name = raw_name;
    if (name.rfind("work@", 0) == 0) name = name.substr(5);

    vpiHandle mod_h = net_handle;
    while (mod_h && vpi_get(vpiType, mod_h) != vpiModule) {
        vpiHandle parent = vpi_handle(vpiParent, mod_h);
        if (!parent || parent == mod_h) { mod_h = nullptr; break; }
        mod_h = parent;
    }
    if (!mod_h) return "";

    vpiHandle port_itr = vpi_iterate(vpiPort, mod_h);
    if (!port_itr) return "";
    std::string result;
    vpiHandle port;
    while ((port = vpi_scan(port_itr)) != nullptr) {
        const char* port_raw_name = vpi_get_str(vpiName, port);
        std::string port_name = port_raw_name ? port_raw_name : "";
        if (port_name.rfind("work@", 0) == 0) port_name = port_name.substr(5);
        if (port_name == name) {
            result = widthFromPortTypespec(port);
            vpi_release_handle(port);
            break;
        }
        vpi_release_handle(port);
    }
    vpi_release_handle(port_itr);
    return result;
}

// Logical, comparison, and reduction operators always produce a single-bit
// result regardless of their operand widths (e.g. `!bus4`, `a == b`,
// `&vec`) — the operand's own width says nothing about the result's width,
// so getWidth()'s generic "Try operands" fallback must not be used for them.
static bool opTypeProducesSingleBitResult(int opType) {
    switch (opType) {
        case vpiNotOp:
        case vpiUnaryAndOp:
        case vpiUnaryNandOp:
        case vpiUnaryOrOp:
        case vpiUnaryNorOp:
        case vpiUnaryXorOp:
        case vpiUnaryXNorOp:
        case vpiEqOp:
        case vpiNeqOp:
        case vpiCaseEqOp:
        case vpiCaseNeqOp:
        case vpiGtOp:
        case vpiGeOp:
        case vpiLtOp:
        case vpiLeOp:
        case vpiLogAndOp:
        case vpiLogOrOp:
            return true;
        default:
            return false;
    }
}

std::string DesignExtractor::getWidth(vpiHandle handle) {
    if (!handle || width_depth_ > 10) return "";
    width_depth_++;
    int type = vpi_get(vpiType, handle);

    // For port handles the VPI range queries return 0/0; use the UHDM object API.
    if (type == vpiPort) {
        std::string w = widthFromPortTypespec(handle);
        width_depth_--;
        return w; // empty means scalar — callers handle that correctly
    }

    if (type == 608) { // vpiRefObj
        vpiHandle actual = vpi_handle(vpiActual, handle);
        if (actual && actual != handle) {
            // Same quirk as the vpiPort case above: net/reg handles reached
            // through a ref-obj report 0/0/0 for vpiLeftRange/vpiRightRange/
            // vpiSize via the plain VPI layer, so try_extract_range (below,
            // reached through the getWidth(actual) recursion) would return
            // the literal, wrong "[0:0]" instead of falling through. These
            // net/reg objects don't carry their own populated typespec
            // either (only the module port declaration does), so resolve
            // through the sibling port by name.
            int actual_type = vpi_get(vpiType, actual);
            if (actual_type == vpiNet || actual_type == vpiReg) {
                std::string w = widthFromSiblingPort(actual);
                if (!w.empty()) {
                    width_depth_--;
                    return w;
                }
            }
            std::string res = getWidth(actual);
            if (!res.empty()) {
                width_depth_--;
                return res;
            }
        }
    }

    auto try_extract_range = [&](vpiHandle h) -> std::string {
        vpiHandle range_itr = vpi_iterate(vpiRange, h);
        if (range_itr) {
            vpiHandle r = vpi_scan(range_itr);
            vpi_release_handle(range_itr);
            if (r) {
                int left = vpi_get(vpiLeftRange, r);
                int right = vpi_get(vpiRightRange, r);
                if (left != vpiUndefined && right != vpiUndefined) {
                    return "[" + std::to_string(left) + ":" + std::to_string(right) + "]";
                }
            }
        }

        int left = vpi_get(vpiLeftRange, h);
        int right = vpi_get(vpiRightRange, h);
        if (left != vpiUndefined && right != vpiUndefined) {
            if (left == 0 && right == 0) {
                int s = vpi_get(vpiSize, h);
                if (s > 1) return "[" + std::to_string(s - 1) + ":0]";
                // A genuine scalar reports vpiSize == 1. Many non-range
                // handles (operations, computed expressions, etc.) report
                // 0/0/0 for all three of vpiLeftRange/vpiRightRange/vpiSize
                // as an "inapplicable" default rather than vpiUndefined —
                // that's not a real answer, so fall through to the other
                // resolution strategies below instead of confidently
                // returning the misleading "[0:0]".
                if (s != 1) return "";
            }
            return "[" + std::to_string(left) + ":" + std::to_string(right) + "]";
        }
        vpiHandle ts = vpi_handle(vpiTypespec, h);
        if (ts) {
            vpiHandle ts_range_itr = vpi_iterate(vpiRange, ts);
            if (ts_range_itr) {
                vpiHandle r = vpi_scan(ts_range_itr);
                vpi_release_handle(ts_range_itr);
                if (r) {
                    int left = vpi_get(vpiLeftRange, r);
                    int right = vpi_get(vpiRightRange, r);
                    if (left != vpiUndefined && right != vpiUndefined) {
                        return "[" + std::to_string(left) + ":" + std::to_string(right) + "]";
                    }
                }
            }

            int ts_left = vpi_get(vpiLeftRange, ts);
            int ts_right = vpi_get(vpiRightRange, ts);
            if (ts_left != vpiUndefined && ts_right != vpiUndefined) {
                return "[" + std::to_string(ts_left) + ":" + std::to_string(ts_right) + "]";
            }
            int ts_size = vpi_get(vpiSize, ts);
            if (ts_size > 1) {
                return "[" + std::to_string(ts_size - 1) + ":0]";
            }
        }
        return "";
    };

    std::string range = try_extract_range(handle);
    if (!range.empty()) {
        width_depth_--;
        return range;
    }

    int size = vpi_get(vpiSize, handle);
    if (size > 1) {
        width_depth_--;
        return "[" + std::to_string(size - 1) + ":0]";
    }

    if (type == vpiBitSelect) {
        int idx = vpi_get(vpiIndex, handle);
        if (idx != vpiUndefined) {
            width_depth_--;
            return "[" + std::to_string(idx) + ":" + std::to_string(idx) + "]";
        }
    }

    // Try parent for selects
    if (type == vpiBitSelect || type == vpiPartSelect) {
        vpiHandle parent = vpi_handle(vpiParent, handle);
        if (parent && parent != handle && vpi_get(vpiType, parent) != vpiModule && vpi_get(vpiType, parent) != vpiContAssign) {
            std::string w = getWidth(parent);
            if (!w.empty()) {
                width_depth_--;
                return w;
            }
        }
    }

    // Try operands. Skip this for a replication (`{N{expr}}`): its first
    // operand is the repeat *count* (e.g. the literal `2`), not a value
    // whose own declared range says anything about the overall expression's
    // width — recursing into it can pick up a constant's internal/default
    // range (observed as a spurious 64-bit "[63:0]") that has nothing to do
    // with the replicated result. The caller (promoteReplicationExpr)
    // already computes the correct width from body size * repeat count.
    // Also skip for logical/comparison/reduction operators, whose result is
    // always 1 bit regardless of operand width (see opTypeProducesSingleBitResult).
    int op_type_for_handle = (type == vpiOperation) ? vpi_get(vpiOpType, handle) : 0;
    bool skip_operand_width = (type == vpiOperation)
        && (op_type_for_handle == vpiMultiConcatOp || opTypeProducesSingleBitResult(op_type_for_handle));
    vpiHandle op_itr = skip_operand_width ? nullptr : vpi_iterate(vpiOperand, handle);
    if (op_itr) {
        vpiHandle op = vpi_scan(op_itr);
        if (op) {
            std::string w = getWidth(op);
            vpi_release_handle(op_itr);
            if (!w.empty()) {
                width_depth_--;
                return w;
            }
        } else {
            vpi_release_handle(op_itr);
        }
    }

    // Try Ranges
    vpiHandle range_itr = vpi_iterate(vpiRange, handle);
    if (range_itr) {
        vpiHandle range = vpi_scan(range_itr);
        if (range) {
             int l = vpi_get(vpiLeftRange, range);
             int r = vpi_get(vpiRightRange, range);
             vpi_release_handle(range_itr);
             if (l != vpiUndefined && r != vpiUndefined) {
                 width_depth_--;
                 return "[" + std::to_string(l) + ":" + std::to_string(r) + "]";
             }
        } else {
            vpi_release_handle(range_itr);
        }
    }

    // Try Typespec
    vpiHandle ts = vpi_handle(vpiTypespec, handle);
    if (ts) {
        int ts_size = vpi_get(vpiSize, ts);
        if (ts_size > 1) {
            width_depth_--;
            return "[" + std::to_string(ts_size-1) + ":0]";
        }
        
        int ts_left = vpi_get(vpiLeftRange, ts);
        int ts_right = vpi_get(vpiRightRange, ts);
        if (ts_left != vpiUndefined && ts_right != vpiUndefined && (ts_left != 0 || ts_right != 0)) {
            width_depth_--;
            return "[" + std::to_string(ts_left) + ":" + std::to_string(ts_right) + "]";
        }
    }

    // Fallback to decompile for cases where size might be reported as 0 or 1 but it's a slice
    if (type == vpiNet || type == vpiReg || type == vpiPort || type == vpiBitSelect || type == vpiPartSelect || type == 44) {
        const char* d = vpi_get_str(vpiDecompile, handle);
        if (d) {
             std::string s = d; size_t pos = s.find('[');
             if (pos != std::string::npos) {
                 std::string range = s.substr(pos);
                 if (range.find(':') != std::string::npos || (range.find(']') != std::string::npos && range.size() > 2)) {
                     width_depth_--;
                     return range;
                 }
             }
        }
    }

    width_depth_--;
    return "";
}

std::string DesignExtractor::getRangeExpression(vpiHandle handle) {
    if (!handle) return "";

    auto range_from = [&](vpiHandle h) -> std::string {
        if (!h) return "";

        vpiHandle range_itr = vpi_iterate(vpiRange, h);
        if (range_itr) {
            vpiHandle r = vpi_scan(range_itr);
            vpi_release_handle(range_itr);
            if (r) {
                vpiHandle left_expr = vpi_handle(vpiLeftRange, r);
                vpiHandle right_expr = vpi_handle(vpiRightRange, r);
                std::string left = getExprText(left_expr);
                std::string right = getExprText(right_expr);
                if (left.empty()) {
                    int value = vpi_get(vpiLeftRange, r);
                    if (value != vpiUndefined) left = std::to_string(value);
                }
                if (right.empty()) {
                    int value = vpi_get(vpiRightRange, r);
                    if (value != vpiUndefined) right = std::to_string(value);
                }
                if (!left.empty() && !right.empty() && (left != "0" || right != "0")) {
                    return "[" + trimCopy(left) + ":" + trimCopy(right) + "]";
                }
            }
        }

        vpiHandle left_expr = vpi_handle(vpiLeftRange, h);
        vpiHandle right_expr = vpi_handle(vpiRightRange, h);
        std::string left = getExprText(left_expr);
        std::string right = getExprText(right_expr);
        if (!left.empty() && !right.empty() && (left != "0" || right != "0")) {
            return "[" + trimCopy(left) + ":" + trimCopy(right) + "]";
        }
        return "";
    };

    std::string range = range_from(handle);
    if (!range.empty()) return range;

    vpiHandle ts = vpi_handle(vpiTypespec, handle);
    if (ts) {
        range = range_from(ts);
        if (!range.empty()) return range;

        int ts_type = vpi_get(vpiType, ts);
        if (ts_type == 608 || ts_type == vpiRefTypespec) {
            vpiHandle actual = vpi_handle(vpiActual, ts);
            range = range_from(actual);
            if (!range.empty()) return range;
        }
    }

    const char* decompile = vpi_get_str(vpiDecompile, handle);
    if (decompile) {
        std::string text = decompile;
        size_t open = text.find('[');
        size_t close = text.find(']', open == std::string::npos ? 0 : open);
        if (open != std::string::npos && close != std::string::npos && close > open) {
            return text.substr(open, close - open + 1);
        }
    }

    return "";
}

std::string DesignExtractor::getTypeName(vpiHandle handle) {
    if (!handle) return "";
    int type = vpi_get(vpiType, handle);

    if (type == vpiEnumTypespec || type == vpiStructTypespec) {
         const char* name = vpi_get_str(vpiName, handle);
         if (name && strlen(name) > 0) {
             std::string s = name;
             if (s.rfind("work@", 0) == 0) s = s.substr(5);
             if (s != "enum" && s != "struct") return s;
         }
    }

    vpiHandle ts = vpi_handle(vpiTypespec, handle);
    if (!ts) ts = vpi_handle(vpiTypedef, handle);
    if (!ts) {
        if (type == 608) { // vpiRefObj
             vpiHandle actual = vpi_handle(vpiActual, handle);
             if (actual && actual != handle) return getTypeName(actual);
        }
        return "";
    }

    int ts_type = vpi_get(vpiType, ts);

    // Follow ref typespecs
    if (ts_type == 608 || ts_type == vpiRefTypespec) {
        vpiHandle actual = vpi_handle(vpiActual, ts);
        if (actual && actual != ts) {
            std::string name = getTypeName(actual);
            if (!name.empty()) return name;
        }
    }

    const char* name = vpi_get_str(vpiName, ts);
    if (name && strlen(name) > 0) {
        std::string s = name;
        if (s.rfind("work@", 0) == 0) s = s.substr(5);
        if (s != "logic" && s != "reg" && s != "wire" && s != "struct" && s != "enum" && s != "int" && s != "integer" && s != "bit") {
            return s;
        }
    }

    // Try to get name from the typedef if it's a typespec
    vpiHandle td = vpi_handle(vpiTypedef, ts);
    if (!td) td = vpi_handle(vpiParent, ts);
    if (td && vpi_get(vpiType, td) == vpiTypedef) {
        const char* td_name = vpi_get_str(vpiName, td);
        if (td_name && strlen(td_name) > 0) {
            std::string s = td_name;
            if (s.rfind("work@", 0) == 0) s = s.substr(5);
            return s;
        }
    }

    return "";
}

SourceInfo DesignExtractor::getTypeSource(vpiHandle handle) {
    if (!handle) return {};
    int type = vpi_get(vpiType, handle);

    if (type == vpiEnumTypespec || type == vpiStructTypespec) {
         SourceInfo src = getSourceInfo(handle);
         if (!src.file.empty() && src.line > 0) return src;
    }

    vpiHandle ts = vpi_handle(vpiTypespec, handle);
    if (!ts) ts = vpi_handle(vpiTypedef, handle);
    if (!ts) {
        if (type == 608) { // vpiRefObj
             vpiHandle actual = vpi_handle(vpiActual, handle);
             if (actual && actual != handle) return getTypeSource(actual);
        }
        return {};
    }

    // Try to get source from the typedef if it's a typespec
    vpiHandle td = vpi_handle(vpiTypedef, ts);
    if (!td) td = vpi_handle(vpiParent, ts);
    if (td && vpi_get(vpiType, td) == vpiTypedef) {
        SourceInfo src = getSourceInfo(td);
        if (!src.file.empty() && src.line > 0) return src;
    }

    // Follow ref typespecs
    int ts_type = vpi_get(vpiType, ts);
    if (ts_type == 608 || ts_type == vpiRefTypespec) {
        vpiHandle actual = vpi_handle(vpiActual, ts);
        if (actual && actual != ts) {
            SourceInfo src = getTypeSource(actual);
            if (!src.file.empty()) return src;
        }
    }

    return getSourceInfo(ts);
}

std::string DesignExtractor::getFile(vpiHandle handle) {
    const char* file = vpi_get_str(vpiFile, handle);
    if (!file || strlen(file) == 0) file = vpi_get_str(vpiDefFile, handle);
    return file ? file : "";
}

int DesignExtractor::getLine(vpiHandle handle) {
    int line = vpi_get(vpiLineNo, handle);
    if (line > 0) return line;
    
    // Try parent
    vpiHandle parent = vpi_handle(vpiParent, handle);
    if (parent && parent != handle) {
        return getLine(parent);
    }
    return 0;
}

int DesignExtractor::getCol(vpiHandle handle) {
    int col = vpi_get(vpiColumnNo, handle);
    return col > 0 ? col - 1 : 0;
}

int DesignExtractor::getEndLine(vpiHandle handle) { return vpi_get(vpiEndLineNo, handle); }

int DesignExtractor::getEndCol(vpiHandle handle) {
    int col = vpi_get(vpiEndColumnNo, handle);
    return col > 0 ? col - 1 : 0;
}

SourceInfo DesignExtractor::getSourceInfo(vpiHandle handle) {
    if (!handle || source_depth_ > 10) return SourceInfo();
    source_depth_++;
    
    // NOTE: Do not follow vpiActual for vpiRefObj here, 
    // as vpiRefObj has the source info of the USAGE, 
    // while vpiActual has the source info of the DECLARATION.

    SourceInfo s;
    s.file = getFile(handle);
    s.line = getLine(handle);
    s.col = getCol(handle);
    s.endLine = getEndLine(handle);
    s.endCol = getEndCol(handle);
    
    // Fix off-by-one for "interface" keyword reporting in Surelog (0-indexed col)
    if (!s.file.empty() && s.line > 0 && s.col >= 1) {
        std::ifstream file = openSourceFile(s.file);
        if (file.is_open()) {
            std::string lineContent;
            for (int i = 1; i <= s.line; ++i) {
                if (!std::getline(file, lineContent)) break;
            }
            if (static_cast<int>(lineContent.size()) >= s.col - 1 + 9) {
                if (lineContent.substr(s.col - 1, 9) == "interface") {
                    s.col--;
                }
            }
        }
    }

    source_depth_--;
    return s;
}

void DesignExtractor::refineSourceInfo(SourceInfo& src, vpiHandle handle) {
    if (!handle || vpi_get(vpiType, handle) != vpiOperation) return;

    vpiHandle op_itr = vpi_iterate(vpiOperand, handle);
    if (!op_itr) return;

    int min_l = 0, min_c = 0, max_el = 0, max_ec = 0;
    bool first = true;
    while (vpiHandle op = vpi_scan(op_itr)) {
        SourceInfo op_src = getSourceInfo(op);
        
        // If child is an operation, it might have an inherited range.
        // Try to refine it before using it in our hull.
        if (vpi_get(vpiType, op) == vpiOperation) {
            refineSourceInfo(op_src, op);
        }

        // HEURISTIC: If child range is identical to parent's, it's likely inherited.
        // Ignore it for refinement if we have other choices.
        if (op_src.line == src.line && op_src.col == src.col && 
            op_src.endLine == src.endLine && op_src.endCol == src.endCol) {
            continue;
        }

        if (op_src.line > 0) {
            if (first || op_src.line < min_l || (op_src.line == min_l && op_src.col < min_c)) {
                min_l = op_src.line;
                min_c = op_src.col;
            }
            if (first || op_src.endLine > max_el || (op_src.endLine == max_el && op_src.endCol > max_ec)) {
                max_el = op_src.endLine;
                max_ec = op_src.endCol;
            }
            first = false;
        }
    }
    vpi_release_handle(op_itr);

    if (!first) {
        // Refine start if hull starts later
        if (min_l > src.line || (min_l == src.line && min_c > src.col)) {
            src.line = min_l;
            src.col = min_c;
        }
        // Refine end if hull ends earlier
        if (max_el > 0 && (src.endLine == 0 || max_el < src.endLine || (max_el == src.endLine && max_ec < src.endCol))) {
            src.endLine = max_el;
            src.endCol = max_ec;
        }
    }
}

std::string DesignExtractor::getExprText(vpiHandle expr) {
    if (!expr) return "";
    const char* decompile = vpi_get_str(vpiDecompile, expr);
    if (decompile) return decompile;

    int type = vpi_get(vpiType, expr);
    if (type == vpiOperation) {
        int op = vpi_get(vpiOpType, expr);
        std::string sym = "";
        bool unary = false;
        switch (op) {
            case vpiAddOp: sym = "+"; break;
            case vpiSubOp: sym = "-"; break;
            case vpiMultOp: sym = "*"; break;
            case vpiDivOp: sym = "/"; break;
            case vpiModOp: sym = "%"; break;
            case vpiEqOp: sym = "=="; break;
            case vpiNeqOp: sym = "!="; break;
            case vpiCaseEqOp: sym = "==="; break;
            case vpiCaseNeqOp: sym = "!=="; break;
            case vpiGtOp: sym = ">"; break;
            case vpiGeOp: sym = ">="; break;
            case vpiLtOp: sym = "<"; break;
            case vpiLeOp: sym = "<="; break;
            case vpiBitAndOp: sym = "&"; break;
            case vpiBitOrOp: sym = "|"; break;
            case vpiBitXorOp: sym = "^"; break;
            case vpiUnaryAndOp: sym = "&"; unary = true; break;
            case vpiUnaryOrOp: sym = "|"; unary = true; break;
            case vpiUnaryXorOp: sym = "^"; unary = true; break;
            case vpiBitNegOp: sym = "~"; unary = true; break;
            case vpiNotOp: sym = "!"; unary = true; break;
            case vpiLogAndOp: sym = "&&"; break;
            case vpiLogOrOp: sym = "||"; break;
            default: break;
        }
        if (!sym.empty()) {
            vpiHandle op_itr = vpi_iterate(vpiOperand, expr);
            if (op_itr) {
                std::vector<std::string> ops;
                while (vpiHandle o = vpi_scan(op_itr)) {
                    std::string ot = getExprText(o);
                    if (vpi_get(vpiType, o) == vpiOperation) ot = "(" + ot + ")";
                    ops.push_back(ot);
                }
                vpi_release_handle(op_itr);
                if (ops.size() == 2) return ops[0] + " " + sym + " " + ops[1];
                if (ops.size() == 1) return unary ? sym + ops[0] : ops[0];
            }
        }
    } else if (type == vpiConstant) {
        return getSignalName(expr);
    } else {
        const char* name = vpi_get_str(vpiName, expr);
        if (name) return name;
    }
    return getSignalName(expr);
}

std::string DesignExtractor::sanitize(const std::string& name) {
    std::string s = name;
    for (char &c : s) {
        if (!std::isalnum((unsigned char)c) && c != '_') {
            c = '_';
        }
    }
    // Remove consecutive underscores
    s.erase(std::unique(s.begin(), s.end(), [](char a, char b) {
        return a == '_' && b == '_';
    }), s.end());
    // Trim underscores from ends
    if (!s.empty() && s.front() == '_') s.erase(0, 1);
    if (!s.empty() && s.back() == '_') s.pop_back();
    return s.empty() ? "val" : s;
}

vpiHandle DesignExtractor::unwrapRef(vpiHandle handle) {
    if (!handle) return nullptr;
    int type = vpi_get(vpiType, handle);
    if (type == 608) { // vpiRefObj
        vpiHandle actual = vpi_handle(vpiActual, handle);
        if (actual && actual != handle) return unwrapRef(actual);
    }
    return handle;
}

bool DesignExtractor::isLiteralExpr(vpiHandle handle) {
    vpiHandle actual = unwrapRef(handle);
    if (!actual) return false;
    int type = vpi_get(vpiType, actual);
    return type == vpiConstant
        || type == vpiParameter
        || type == vpiEnumConst
        || vpi_get(vpiLocalParam, actual);
}

std::string DesignExtractor::getLiteralLabel(vpiHandle handle) {
    vpiHandle actual = unwrapRef(handle);
    if (!actual) return "";

    if (actual != handle) {
        const char* ref_decompile = vpi_get_str(vpiDecompile, handle);
        if (ref_decompile && strlen(ref_decompile) > 0) {
            std::string s = ref_decompile;
            if (s.rfind("work@", 0) == 0) s = s.substr(5);
            return s;
        }

        const char* ref_name = vpi_get_str(vpiName, handle);
        if (ref_name && strlen(ref_name) > 0) {
            std::string s = ref_name;
            if (s.rfind("work@", 0) == 0) s = s.substr(5);
            return s;
        }
    }

    int type = vpi_get(vpiType, actual);
    if (type == vpiParameter || type == vpiEnumConst || vpi_get(vpiLocalParam, actual)) {
        const char* name = vpi_get_str(vpiName, handle);
        if (!name || strlen(name) == 0) name = vpi_get_str(vpiName, actual);
        if (name && strlen(name) > 0) {
            std::string s = name;
            if (s.rfind("work@", 0) == 0) s = s.substr(5);
            return s;
        }
    }

    const char* decompile = vpi_get_str(vpiDecompile, actual);
    if (decompile && strlen(decompile) > 0) return decompile;

    std::string signal_name = getSignalName(actual);
    return signal_name.empty() ? "const" : signal_name;
}

std::string DesignExtractor::getAssignmentRhsText(vpiHandle assignment_handle) {
    if (!assignment_handle) return "";
    SourceInfo source = getSourceInfo(assignment_handle);
    if (source.file.empty() || source.line <= 0) return "";

    std::ifstream file = openSourceFile(source.file);
    if (!file.is_open()) return "";

    std::stringstream buffer;
    std::string line;
    int line_no = 1;
    while (std::getline(file, line)) {
        if (line_no >= source.line && (source.endLine <= 0 || line_no <= source.endLine)) {
            if (line_no == source.line && source.col > 0) {
                size_t start_col = static_cast<size_t>(std::max(0, source.col - 1));
                if (start_col < line.size()) line = line.substr(start_col);
            }
            if (buffer.tellp() > 0) buffer << "\n";
            buffer << line;
        }
        if (source.endLine > 0 && line_no > source.endLine) break;
        line_no++;
    }

    std::string text = buffer.str();
    size_t op = text.find("<=");
    size_t op_len = 2;
    if (op == std::string::npos) {
        op = text.find('=');
        op_len = 1;
    }
    if (op == std::string::npos) return "";

    std::string rhs = text.substr(op + op_len);
    size_t semicolon = rhs.find(';');
    if (semicolon != std::string::npos) rhs = rhs.substr(0, semicolon);
    size_t comment = rhs.find("//");
    if (comment != std::string::npos) rhs = rhs.substr(0, comment);
    return trimCopy(rhs);
}

std::string DesignExtractor::getDeclaredSignalWidth(const Module& mod, const std::string& signal) {
    if (signal.empty()) return "";

    for (const auto& port : mod.ports) {
        if (port.name == signal && !port.width.empty() && port.width != "[0:0]") return port.width;
    }

    std::string source_file = mod.source.file;
    if (source_file.empty()) {
        for (const auto& port : mod.ports) {
            if (!port.source.file.empty()) {
                source_file = port.source.file;
                break;
            }
        }
    }
    
    if (source_file.empty()) return "";

    std::ifstream file = openSourceFile(source_file);
    if (!file.is_open()) return "";

    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string text = buffer.str();
    std::string escaped_signal;
    for (char c : signal) {
        if (std::string(".^$|()[]{}*+?_\\").find(c) != std::string::npos) escaped_signal += "\\";
        escaped_signal += c;
    }

    std::regex decl_re(R"((?:input|output|inout)?\s*(?:logic|wire|reg)\s+(\[[^\]]+\])([^,;\)\n]*))");
    std::sregex_iterator next(text.begin(), text.end(), decl_re);
    std::sregex_iterator end;
    while (next != end) {
        std::string range = (*next)[1].str();
        std::string vars = (*next)[2].str();
        std::regex var_re(R"(\b)" + escaped_signal + R"(\b)");
        if (std::regex_search(vars, var_re)) {
            return range;
        }
        next++;
    }

    std::map<std::string, std::string> type_widths;
    std::regex enum_type_re(R"(typedef\s+enum\s+(?:\w+\s+)*(\[[^\]]+\])\s*\{[^}]*\}\s*(\w+)\s*;)");
    for (std::sregex_iterator it(text.begin(), text.end(), enum_type_re), end; it != end; ++it) {
        type_widths[(*it)[2].str()] = (*it)[1].str();
    }

    std::regex typed_decl_re(R"((?:^|[;\n])\s*(\w+)\s+([^;]+);)");
    for (std::sregex_iterator it(text.begin(), text.end(), typed_decl_re), end; it != end; ++it) {
        std::string type_name = (*it)[1].str();
        auto width_it = type_widths.find(type_name);
        if (width_it != type_widths.end() && declarationListContains((*it)[2].str(), signal)) {
            return width_it->second;
        }
    }

    std::regex vector_decl_re(R"((?:^|[;\n,])\s*(?:(?:input|output|inout)\s+)?(?:logic|wire|reg)\s+(\[[^\]]+\])\s+([^;,\)]+))");
    for (std::sregex_iterator it(text.begin(), text.end(), vector_decl_re), end; it != end; ++it) {
        if (declarationListContains((*it)[2].str(), signal)) {
            return (*it)[1].str();
        }
    }

    return "";
}

std::string DesignExtractor::getDeclaredArrayDimension(const Module& mod, const std::string& signal) {
    if (signal.empty() || mod.source.file.empty()) return "";

    std::ifstream file = openSourceFile(mod.source.file);
    if (!file.is_open()) return "";
    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string text = buffer.str();

    // Match: optional port direction, (logic|reg|wire), optional packed range,
    // signal_name, unpacked range. E.g. "logic [31:0] M [0:7]".
    std::string escaped;
    for (char c : signal) {
        if (std::string(R"(\.^$|()[]{}*+?)").find(c) != std::string::npos) escaped.push_back('\\');
        escaped.push_back(c);
    }
    std::regex array_decl_re(
        std::string(R"((?:input|output|inout)?\s*(?:logic|reg|wire)\s+(?:\[[^\]]+\]\s+)?(?:\w+\s+)*)") + escaped
        + R"(\s*(\[[\s\d:]+\]))"
    );
    std::smatch m;
    if (std::regex_search(text, m, array_decl_re)) {
        return m[1].str();
    }
    return "";
}

void DesignExtractor::ensureDeclaredArray(Module& mod, const std::string& signal) {
    if (signal.empty() || mod.arrayDimensions.count(signal)) return;
    std::string dim = getDeclaredArrayDimension(mod, signal);
    if (dim.empty()) return;

    std::string s = dim;
    s.erase(std::remove(s.begin(), s.end(), ' '), s.end());
    if (s.size() < 4 || s[0] != '[' || s.back() != ']') return;

    s = s.substr(1, s.size() - 2);
    auto colon = s.find(':');
    if (colon == std::string::npos) return;

    try {
        int lft = std::stoi(s.substr(0, colon));
        int rgt = std::stoi(s.substr(colon + 1));
        mod.arrayDimensions[signal] = dim;
        mod.arraySizes[signal] = std::abs(lft - rgt) + 1;
        mod.internalSignals.insert(signal);
    } catch (...) {
        return;
    }
}

std::string DesignExtractor::getDeclaredLiteralWidth(const Module& mod, const std::string& literal) {
    if (literal.empty() || mod.source.file.empty()) return "";

    std::ifstream file = openSourceFile(mod.source.file);
    if (!file.is_open()) return "";

    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string text = buffer.str();

    std::regex enum_type_re(R"(typedef\s+enum\s+(?:\w+\s+)*(\[[^\]]+\])\s*\{([^}]*)\}\s*(\w+)\s*;)");
    for (std::sregex_iterator it(text.begin(), text.end(), enum_type_re), end; it != end; ++it) {
        std::string members = (*it)[2].str();
        if (declarationListContains(members, literal)) {
            return (*it)[1].str();
        }
    }

    return getDeclaredSignalWidth(mod, literal);
}

void DesignExtractor::removeUnconnectedLiteralNodes(Module& mod) {
    std::set<std::string> connected_node_ids;
    for (const auto& e : mod.edges) {
        connected_node_ids.insert(e.source);
        connected_node_ids.insert(e.target);
    }
    
    std::vector<Node> filtered_nodes;
    for (const auto& n : mod.nodes) {
        if (n.kind != "literal" || connected_node_ids.count(n.id)) {
            filtered_nodes.push_back(n);
        }
    }
    mod.nodes = filtered_nodes;
}

std::string getWidthFromSlice(const std::string& slice) {
    std::regex re(R"(\[(\d+):(\d+)\])");
    std::smatch match;
    if (std::regex_search(slice, match, re)) {
        int a = std::stoi(match[1].str());
        int b = std::stoi(match[2].str());
        int w = std::abs(a - b) + 1;
        return "[" + std::to_string(w - 1) + ":0]";
    }
    return "";
}

void DesignExtractor::repairResolvedExplicitBusCompositions(Module& mod) {
    for (auto& node : mod.nodes) {
        if (node.kind != "bus" || node.id.rfind("bus_comp:" + mod.name + ":", 0) != 0) continue;
        if (node.metadata.aggregateKind == "array") continue;

        NodePort* output_port = nullptr;
        for (auto& port : node.ports) {
            if (port.direction == "output") {
                output_port = &port;
                break;
            }
        }

        if (output_port && !output_port->signal.empty()) {
            std::string declared_width = "";
            for (const auto& p : mod.ports) {
                if (p.name == output_port->signal) {
                    declared_width = p.width;
                    break;
                }
            }
            if (!declared_width.empty()) {
                output_port->width = declared_width;
            }
        }

        for (auto& port : node.ports) {
            if (port.direction != "input") continue;
            std::string slice_width = getWidthFromSlice(port.name);
            if (!slice_width.empty()) {
                port.width = slice_width;
            }
        }

        for (auto& edge : mod.edges) {
            if (edge.target == node.id && !edge.targetPort.empty()) {
                for (const auto& p : node.ports) {
                    if (p.name == edge.targetPort) {
                        if (!p.width.empty()) edge.width = p.width;
                        break;
                    }
                }
            }
            if (edge.source == node.id && !edge.sourcePort.empty()) {
                for (const auto& p : node.ports) {
                    if (p.name == edge.sourcePort) {
                        if (!p.width.empty()) edge.width = p.width;
                        break;
                    }
                }
            }
        }
    }
}

bool isPromotedConcatBus(const Node& node) {
    if (node.kind != "bus") return false;
    if (node.metadata.aggregateKind == "array") return false;
    if (node.metadata.expression == "[aggregate-compose]" || node.metadata.expression == "[aggregate-breakout]") return false;
    
    bool has_output = false;
    int num_inputs = 0;
    for (const auto& port : node.ports) {
        if (port.direction == "output") has_output = true;
        else if (port.direction == "input") num_inputs++;
    }
    return has_output && num_inputs > 1;
}

std::string widthFromBitSize(int size) {
    if (size <= 0) return "[0:0]";
    return "[" + std::to_string(size - 1) + ":0]";
}

std::string concatSliceLabel(int highBit, int size) {
    if (size == 1) return "[" + std::to_string(highBit) + "]";
    return "[" + std::to_string(highBit) + ":" + std::to_string(highBit - size + 1) + "]";
}

std::string findNodeOutputWidth(const std::vector<Node>& nodes, const std::string& signal) {
    if (signal.empty()) return "";
    
    for (const auto& n : nodes) {
        for (const auto& p : n.ports) {
            if (p.direction == "output" && p.signal == signal && !p.width.empty()) {
                return p.width;
            }
        }
    }
    
    for (const auto& n : nodes) {
        for (const auto& p : n.ports) {
            if (p.direction == "output" && p.signal == signal) {
                return p.width;
            }
        }
    }
    return "";
}

void DesignExtractor::repairResolvedBusCompositionSlices(Module& mod) {
    bool changed = true;
    int max_iters = 10;

    while (changed && max_iters-- > 0) {
        changed = false;
        for (auto& node : mod.nodes) {
            if (!isPromotedConcatBus(node)) continue;
            
            std::vector<NodePort*> input_ports;
            for (auto& port : node.ports) {
                if (port.direction == "input") input_ports.push_back(&port);
            }
            if (input_ports.empty()) continue;

            std::vector<std::string> input_widths;
            int total_size = 0;
            for (auto* port : input_ports) {
                std::string width = "";
                for (const auto& p : mod.ports) {
                    if (p.name == port->signal) {
                        width = p.width;
                        break;
                    }
                }
                if (width.empty() || width == "[0:0]") width = getDeclaredSignalWidth(mod, port->signal);
                if (width.empty()) width = findNodeOutputWidth(mod.nodes, port->signal);
                if (width.empty()) width = port->width;
                if (width.empty()) width = "[0:0]";
                
                input_widths.push_back(width);
                total_size += bitSizeFromWidth(width);
            }
            
            if (total_size <= 0) continue;

            NodePort* output_port = nullptr;
            for (auto& port : node.ports) {
                if (port.direction == "output") {
                    output_port = &port;
                    break;
                }
            }

            std::string new_output_width = widthFromBitSize(total_size);
            if (total_size > 1) {
                new_output_width = "[" + std::to_string(total_size - 1) + ":0]";
            } else if (total_size == 1) {
                new_output_width = "[0:0]";
            }
            if (output_port && bitSizeFromWidth(output_port->width) < total_size) {
                if (output_port->width != new_output_width) {
                    output_port->width = new_output_width;
                    changed = true;
                }
            }
        
        std::string output_width = output_port ? output_port->width : "";
        
            if (output_port && !output_port->signal.empty() && !output_width.empty()) {
                for (auto& consumer : mod.nodes) {
                    for (auto& port : consumer.ports) {
                        if (port.direction == "input" && port.signal == output_port->signal) {
                            if (port.width != output_width) {
                                port.width = output_width;
                                changed = true;
                            }
                        }
                    }
                }
            }

            int current_bit = total_size - 1;
            for (size_t i = 0; i < input_ports.size(); i++) {
                auto* port = input_ports[i];
                std::string width = input_widths[i];
                int size = bitSizeFromWidth(width);
                std::string label = concatSliceLabel(current_bit, size);
                
                std::string old_name = port->name;
                if (old_name != label) {
                    port->name = label;
                    for (auto& edge : mod.edges) {
                        if (edge.target == node.id && edge.targetPort == old_name) {
                            edge.targetPort = label;
                        }
                    }
                }
                if (port->label != label || port->width != width) changed = true;
                port->label = label;
                port->width = width;
                current_bit -= size;
            }

            for (auto& edge : mod.edges) {
                if (edge.target == node.id && !edge.targetPort.empty()) {
                    for (auto* port : input_ports) {
                        if (port->name == edge.targetPort) {
                            if (!port->width.empty() && edge.width != port->width) {
                                edge.width = port->width;
                                changed = true;
                            }
                            break;
                        }
                    }
                }
                if (edge.source == node.id && !edge.sourcePort.empty() && !output_width.empty()) {
                    for (auto& port : node.ports) {
                        if (port.name == edge.sourcePort && port.direction == "output") {
                            if (edge.width != output_width) {
                                edge.width = output_width;
                                changed = true;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
}
