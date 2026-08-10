namespace {

bool isGenerateConditionalType(int type) {
    return type == vpiGenIf || type == vpiGenIfElse || type == vpiGenCase;
}

bool validSource(const SourceInfo& source) {
    return !source.file.empty() && source.line > 0;
}

SourceInfo firstValidSource(const std::vector<SourceInfo>& sources) {
    for (const auto& source : sources) {
        if (validSource(source)) return source;
    }
    return SourceInfo{};
}

std::string generateStripWorkPrefix(std::string value) {
    if (value.rfind("work@", 0) == 0) value = value.substr(5);
    return value;
}

std::string lastNameComponent(std::string value) {
    value = generateStripWorkPrefix(value);
    size_t dot = value.rfind('.');
    if (dot != std::string::npos && dot + 1 < value.size()) value = value.substr(dot + 1);
    return value;
}

std::string handleName(vpiHandle handle, bool full) {
    if (!handle) return "";
    const char* raw = vpi_get_str(full ? vpiFullName : vpiName, handle);
    if (!raw || strlen(raw) == 0) return "";
    return generateStripWorkPrefix(raw);
}

bool isGenScopeHandle(vpiHandle handle) {
    if (!handle) return false;
    const int type = vpi_get(vpiType, handle);
    return type == vpiGenScopeArray || type == vpiGenScope;
}

// An unlabeled arm body is a plain begin block with no vpiName; its vpiFullName is
// just the enclosing scope path, so falling back to it would leak the parent/module
// name as the arm's label. Only gen scopes may take their label from the full name.
std::string blockLabelForStmt(vpiHandle stmt) {
    std::string name = handleName(stmt, false);
    if (name.empty() && isGenScopeHandle(stmt)) name = handleName(stmt, true);
    return lastNameComponent(name);
}

std::string fullBlockLabelForStmt(vpiHandle stmt) {
    if (handleName(stmt, false).empty() && !isGenScopeHandle(stmt)) return "";
    std::string full = handleName(stmt, true);
    if (!full.empty()) return full;
    return handleName(stmt, false);
}

std::string appendBlockLabel(std::string label, const std::string& blockLabel) {
    if (!blockLabel.empty()) label += " (" + blockLabel + ")";
    return label;
}

std::string generateArmDisplayLabel(const std::string& blockLabel, const std::string& expression) {
    const std::string code = expression.empty() ? "?" : expression;
    if (!blockLabel.empty()) return blockLabel + " /* " + code + " */";
    return "/* " + code + " */";
}

std::string joinStrings(const std::vector<std::string>& values, const std::string& separator) {
    std::string joined;
    for (const auto& value : values) {
        if (!joined.empty()) joined += separator;
        joined += value;
    }
    return joined;
}

vpiHandle unwrapSingleGenerateStmt(vpiHandle stmt) {
    if (!stmt) return nullptr;
    int type = vpi_get(vpiType, stmt);
    if (type == vpiGenIf || type == vpiGenIfElse || type == vpiGenCase) return stmt;

    vpiHandle direct = vpi_handle(vpiStmt, stmt);
    if (direct && direct != stmt) {
        int direct_type = vpi_get(vpiType, direct);
        if (direct_type == vpiGenIf || direct_type == vpiGenIfElse || direct_type == vpiGenCase) return direct;
    }

    vpiHandle itr = vpi_iterate(vpiStmt, stmt);
    if (!itr) return nullptr;

    vpiHandle only = nullptr;
    int count = 0;
    while (vpiHandle child = vpi_scan(itr)) {
        if (child == stmt) continue;
        only = child;
        count++;
        if (count > 1) break;
    }
    vpi_release_handle(itr);

    if (count == 1 && only) {
        int only_type = vpi_get(vpiType, only);
        if (only_type == vpiGenIf || only_type == vpiGenIfElse || only_type == vpiGenCase) return only;
    }
    return nullptr;
}

std::string generateGroupId(const std::string& moduleName, const std::string& kind, const SourceInfo& source) {
    return "generate-group:" + moduleName + ":" + kind + ":" + std::to_string(source.line) + ":" + std::to_string(source.col);
}

std::string generateRegionId(const std::string& moduleName, const std::string& kind, const SourceInfo& source, int armIndex, const std::string& label) {
    return "generate-region:" + moduleName + ":" + kind + ":" + std::to_string(source.line) + ":" + std::to_string(source.col) + ":" + std::to_string(armIndex) + ":" + sanitizeId(label);
}

void pushUnique(std::vector<std::string>& values, const std::string& value) {
    if (value.empty()) return;
    if (std::find(values.begin(), values.end(), value) == values.end()) {
        values.push_back(value);
    }
}

std::string scopedGenerateLabel(const GenerateRegion& region, const std::string& label) {
    if (label.empty() || region.blockLabel.empty()) return label;
    const std::string prefix = region.blockLabel + ".";
    if (label == region.blockLabel || label.rfind(prefix, 0) == 0) return label;
    return prefix + label;
}

void markGenerateOwned(Node& node, const GenerateRegion& region) {
    node.metadata.generateRegionId = region.id;
    node.metadata.generateActiveState = region.activeState;
}

bool labelMatchesActiveScope(const std::string& label, const std::string& activeScope) {
    if (label.empty() || activeScope.empty()) return false;
    if (activeScope == label) return true;
    const std::string suffix = "." + label;
    return activeScope.size() > suffix.size()
        && activeScope.compare(activeScope.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool regionMatchesActiveScope(const GenerateRegion& region, const std::string& activeScope) {
    return labelMatchesActiveScope(region.fullBlockLabel, activeScope)
        || labelMatchesActiveScope(region.blockLabel, activeScope)
        || lastNameComponent(activeScope) == region.blockLabel;
}

std::optional<int> parseGenerateInteger(std::string text) {
    text = trimCopy(text);
    if (text.empty()) return std::nullopt;

    std::smatch sized;
    if (std::regex_search(text, sized, std::regex(R"((?:\d+)?'[sS]?[dD]\s*(-?\d+))"))) {
        try { return std::stoi(sized[1].str()); } catch (...) { return std::nullopt; }
    }
    if (std::regex_search(text, sized, std::regex(R"((?:\d+)?'[sS]?[bB]\s*([01_xXzZ]+))"))) {
        std::string bits = sized[1].str();
        bits.erase(std::remove(bits.begin(), bits.end(), '_'), bits.end());
        if (bits.find_first_not_of("01") != std::string::npos) return std::nullopt;
        try { return std::stoi(bits, nullptr, 2); } catch (...) { return std::nullopt; }
    }

    std::smatch plain;
    if (std::regex_match(text, plain, std::regex(R"(^\s*(-?\d+)\s*$)"))) {
        try { return std::stoi(plain[1].str()); } catch (...) { return std::nullopt; }
    }
    return std::nullopt;
}

std::map<std::string, int> generateParameterValues(const Module& mod) {
    std::map<std::string, int> values;
    for (const auto& parameter : mod.parameters) {
        auto value = parseGenerateInteger(parameter.defaultValue);
        if (value) values[parameter.name] = *value;
    }
    return values;
}

std::optional<bool> evaluateGenerateCondition(const std::string& condition, const std::map<std::string, int>& parameters) {
    std::smatch match;
    if (!std::regex_match(condition, match, std::regex(R"(^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(==|!=)\s*(.*?)\s*$)"))) {
        return std::nullopt;
    }
    auto lhs = parameters.find(match[1].str());
    auto rhs = parseGenerateInteger(match[3].str());
    if (lhs == parameters.end() || !rhs) return std::nullopt;
    const bool equal = lhs->second == *rhs;
    return match[2].str() == "==" ? equal : !equal;
}

std::optional<bool> evaluateGenerateCaseValue(const GenerateRegion& region, const std::map<std::string, int>& parameters) {
    auto selector = parameters.find(region.selector);
    if (selector == parameters.end() || region.caseValue.empty() || region.caseValue == "default") {
        return std::nullopt;
    }

    std::stringstream stream(region.caseValue);
    std::string valueText;
    while (std::getline(stream, valueText, ',')) {
        auto value = parseGenerateInteger(valueText);
        if (value && *value == selector->second) return true;
    }
    return false;
}

void collectActiveGenerateScopeNames(vpiHandle handle, std::set<vpiHandle>& visited, std::set<std::string>& activeScopes, int depth = 0) {
    if (!handle || depth > 128 || visited.count(handle)) return;
    visited.insert(handle);

    const int type = vpi_get(vpiType, handle);
    if (type == vpiGenScopeArray || type == vpiGenScope) {
        std::string full = fullBlockLabelForStmt(handle);
        if (!full.empty()) activeScopes.insert(full);
    }

    for (int iter_type : {vpiGenScopeArray, vpiGenScope}) {
        vpiHandle itr = vpi_iterate(iter_type, handle);
        if (!itr) continue;
        while (vpiHandle child = vpi_scan(itr)) {
            collectActiveGenerateScopeNames(child, visited, activeScopes, depth + 1);
        }
        vpi_release_handle(itr);
    }
}

void syncGenerateNodeActiveStates(Module& mod) {
    std::map<std::string, GenerateRegion*> regionById;
    for (auto& region : mod.generateRegions) regionById[region.id] = &region;
    for (auto& node : mod.nodes) {
        if (node.metadata.generateRegionId.empty()) continue;
        auto regionIt = regionById.find(node.metadata.generateRegionId);
        if (regionIt != regionById.end()) {
            node.metadata.generateActiveState = regionIt->second->activeState;
        }
    }
}

void markSiblingAlternativesInactive(Module& mod) {
    std::map<std::string, bool> activeByGroup;
    for (const auto& region : mod.generateRegions) {
        if (region.activeState != "active") continue;
        const std::string group = region.siblingGroupId.empty() ? region.id : region.siblingGroupId;
        activeByGroup[group] = true;
    }

    for (auto& region : mod.generateRegions) {
        const std::string group = region.siblingGroupId.empty() ? region.id : region.siblingGroupId;
        if (activeByGroup[group] && region.activeState != "active") {
            region.activeState = "inactive";
        }
    }
}

void applyGenerateActiveFallback(Module& mod) {
    const auto parameters = generateParameterValues(mod);
    if (parameters.empty()) return;

    std::map<std::string, std::vector<GenerateRegion*>> groups;
    for (auto& region : mod.generateRegions) {
        const std::string group = region.siblingGroupId.empty() ? region.id : region.siblingGroupId;
        groups[group].push_back(&region);
    }

    for (auto& [groupId, group] : groups) {
        if (std::any_of(group.begin(), group.end(), [](const GenerateRegion* region) { return region->activeState == "active"; })) {
            continue;
        }
        std::sort(group.begin(), group.end(), [](const GenerateRegion* a, const GenerateRegion* b) {
            return a->armIndex < b->armIndex;
        });

        const bool isCaseGroup = std::any_of(group.begin(), group.end(), [](const GenerateRegion* region) {
            return region->kind == "case" || region->kind == "case-default";
        });

        if (isCaseGroup) {
            GenerateRegion* defaultRegion = nullptr;
            bool anyKnown = false;
            for (GenerateRegion* region : group) {
                if (region->kind == "case-default") {
                    defaultRegion = region;
                    continue;
                }
                auto matched = evaluateGenerateCaseValue(*region, parameters);
                if (!matched) continue;
                anyKnown = true;
                if (*matched) {
                    region->activeState = "active";
                    break;
                }
            }
            if (!std::any_of(group.begin(), group.end(), [](const GenerateRegion* region) { return region->activeState == "active"; })
                && anyKnown && defaultRegion) {
                defaultRegion->activeState = "active";
            }
            continue;
        }

        bool sawKnownCondition = false;
        bool matchedArm = false;
        for (GenerateRegion* region : group) {
            if (region->kind == "else") {
                if (sawKnownCondition && !matchedArm) region->activeState = "active";
                break;
            }

            auto condition = evaluateGenerateCondition(region->condition, parameters);
            if (!condition) continue;
            sawKnownCondition = true;
            if (*condition && !matchedArm) {
                region->activeState = "active";
                matchedArm = true;
            }
        }
    }
}

void applyGenerateActiveStates(Module& mod, const std::set<std::string>& activeScopes) {
    if (mod.generateRegions.empty()) return;

    for (auto& region : mod.generateRegions) {
        for (const auto& activeScope : activeScopes) {
            if (regionMatchesActiveScope(region, activeScope)) {
                region.activeState = "active";
                break;
            }
        }
    }

    applyGenerateActiveFallback(mod);
    markSiblingAlternativesInactive(mod);
    syncGenerateNodeActiveStates(mod);
}

Node* findNodeById(Module& mod, const std::string& id) {
    for (auto& node : mod.nodes) {
        if (node.id == id) return &node;
    }
    return nullptr;
}

std::string portDirectionString(int direction) {
    if (direction == vpiInput) return "input";
    if (direction == vpiOutput) return "output";
    if (direction == vpiInout) return "inout";
    return "unknown";
}

} // namespace

void DesignExtractor::processGenerateRegions(vpiHandle module_handle, Module& mod) {
    std::set<vpiHandle> visited;
    std::set<std::string> activeScopes;
    std::set<vpiHandle> activeVisited;
    collectActiveGenerateScopeNames(module_handle, activeVisited, activeScopes);
    collectActiveGenerateScopeNames(design_, activeVisited, activeScopes);

    for (int iter_type : {vpiGenStmt, vpiGenRegion}) {
        vpiHandle gen_itr = vpi_iterate(iter_type, module_handle);
        if (!gen_itr) continue;

        while (vpiHandle gen_handle = vpi_scan(gen_itr)) {
            walkGenerateRegionTree(gen_handle, mod, "", visited, 0);
        }
        vpi_release_handle(gen_itr);
    }

    applyGenerateActiveStates(mod, activeScopes);
}

void DesignExtractor::walkGenerateRegionTree(vpiHandle handle, Module& mod, const std::string& parentRegionId, std::set<vpiHandle>& visited, int depth) {
    if (!handle || depth > 128) return;
    if (visited.count(handle)) return;
    visited.insert(handle);

    const int type = vpi_get(vpiType, handle);
    if (type == vpiGenIf || type == vpiGenIfElse) {
        collectGenerateIfRegions(handle, mod, parentRegionId, visited, depth + 1);
        return;
    }
    if (type == vpiGenCase) {
        collectGenerateCaseRegions(handle, mod, parentRegionId, visited, depth + 1);
        return;
    }

    vpiHandle stmt = vpi_handle(vpiStmt, handle);
    if (stmt && stmt != handle) {
        walkGenerateRegionTree(stmt, mod, parentRegionId, visited, depth + 1);
    }

    for (int iter_type : {vpiStmt, vpiCaseItem}) {
        vpiHandle itr = vpi_iterate(iter_type, handle);
        if (!itr) continue;
        while (vpiHandle child = vpi_scan(itr)) {
            if (child && child != handle) {
                if (iter_type == vpiCaseItem) {
                    vpiHandle item_stmt = vpi_handle(vpiStmt, child);
                    if (item_stmt) walkGenerateRegionTree(item_stmt, mod, parentRegionId, visited, depth + 1);
                } else {
                    walkGenerateRegionTree(child, mod, parentRegionId, visited, depth + 1);
                }
            }
        }
        vpi_release_handle(itr);
    }

    vpiHandle else_stmt = vpi_handle(vpiElseStmt, handle);
    if (else_stmt && else_stmt != handle) {
        walkGenerateRegionTree(else_stmt, mod, parentRegionId, visited, depth + 1);
    }
}

// The body of a generate arm is usually a gen_scope_array whose own handle carries no
// location info; the named gen_scope inside it does. Descend until a located handle is
// found so arms get a usable begin..end span for source navigation.
SourceInfo DesignExtractor::generateStmtBodySource(vpiHandle stmt, int depth) {
    if (!stmt || depth > 8) return SourceInfo{};
    SourceInfo direct = getSourceInfo(stmt);
    if (validSource(direct)) return direct;

    for (int iter_type : {vpiGenScopeArray, vpiGenScope, vpiStmt}) {
        vpiHandle itr = vpi_iterate(iter_type, stmt);
        if (!itr) continue;
        while (vpiHandle child = vpi_scan(itr)) {
            if (child == stmt) continue;
            SourceInfo nested = generateStmtBodySource(child, depth + 1);
            if (validSource(nested)) {
                vpi_release_handle(itr);
                return nested;
            }
        }
        vpi_release_handle(itr);
    }
    return SourceInfo{};
}

void DesignExtractor::collectGenerateIfRegions(vpiHandle gen_handle, Module& mod, const std::string& parentRegionId, std::set<vpiHandle>& visited, int depth) {
    SourceInfo source = getSourceInfo(gen_handle);
    // A keyword-less generate if (no generate/endgenerate) reports no location on
    // its own handle; anchor the sibling group at the condition instead so two
    // distinct chains in one module don't collapse into a single group.
    SourceInfo groupAnchor = firstValidSource({source, getSourceInfo(vpi_handle(vpiCondition, gen_handle))});
    std::string groupId = generateGroupId(mod.name, "if", groupAnchor);
    int armIndex = 0;
    collectGenerateIfArms(gen_handle, mod, groupId, parentRegionId, armIndex, visited, depth + 1, false, source);
}

void DesignExtractor::collectGenerateIfArms(
    vpiHandle gen_handle,
    Module& mod,
    const std::string& siblingGroupId,
    const std::string& parentRegionId,
    int& armIndex,
    std::set<vpiHandle>& visited,
    int depth,
    bool isElseIf,
    const SourceInfo& groupSource
) {
    if (!gen_handle || depth > 128) return;

    vpiHandle cond = vpi_handle(vpiCondition, gen_handle);
    vpiHandle true_stmt = vpi_handle(vpiStmt, gen_handle);
    const std::string condition = getExprText(cond);
    const std::string branchKind = isElseIf ? "else-if" : "if";
    const std::string labelPrefix = isElseIf ? "else if" : "if";
    const std::string blockLabel = blockLabelForStmt(true_stmt);
    SourceInfo branchSource = firstValidSource({getSourceInfo(true_stmt), getSourceInfo(cond), getSourceInfo(gen_handle)});

    GenerateRegion region;
    region.kind = branchKind;
    region.condition = condition;
    region.blockLabel = blockLabel;
    region.fullBlockLabel = fullBlockLabelForStmt(true_stmt);
    region.parentRegionId = parentRegionId;
    region.siblingGroupId = siblingGroupId;
    region.armIndex = armIndex++;
    region.source = firstValidSource({getSourceInfo(cond), branchSource, getSourceInfo(gen_handle)});
    region.bodySource = generateStmtBodySource(true_stmt);
    region.groupSource = firstValidSource({groupSource, getSourceInfo(gen_handle)});
    const std::string idLabel = appendBlockLabel(labelPrefix + " (" + (condition.empty() ? "?" : condition) + ")", blockLabel);
    region.label = generateArmDisplayLabel(blockLabel, condition);
    region.id = generateRegionId(mod.name, region.kind, branchSource, region.armIndex, idLabel);
    const size_t regionIndex = mod.generateRegions.size();
    mod.generateRegions.push_back(region);

    if (true_stmt) {
        std::set<vpiHandle> bodyVisited;
        collectGenerateRegionBody(true_stmt, mod, mod.generateRegions[regionIndex], bodyVisited, depth + 1);
        const std::string regionId = mod.generateRegions[regionIndex].id;
        walkGenerateRegionTree(true_stmt, mod, regionId, visited, depth + 1);
    }

    vpiHandle false_stmt = vpi_handle(vpiElseStmt, gen_handle);
    if (!false_stmt) return;

    vpiHandle nested_if = unwrapSingleGenerateStmt(false_stmt);
    if (nested_if && (vpi_get(vpiType, nested_if) == vpiGenIf || vpi_get(vpiType, nested_if) == vpiGenIfElse)) {
        collectGenerateIfArms(nested_if, mod, siblingGroupId, parentRegionId, armIndex, visited, depth + 1, true, firstValidSource({groupSource, getSourceInfo(gen_handle)}));
        return;
    }

    const std::string elseBlockLabel = blockLabelForStmt(false_stmt);
    SourceInfo elseSource = firstValidSource({getSourceInfo(false_stmt), getSourceInfo(gen_handle)});

    GenerateRegion elseRegion;
    elseRegion.kind = "else";
    elseRegion.condition = "else";
    elseRegion.blockLabel = elseBlockLabel;
    elseRegion.fullBlockLabel = fullBlockLabelForStmt(false_stmt);
    elseRegion.parentRegionId = parentRegionId;
    elseRegion.siblingGroupId = siblingGroupId;
    elseRegion.armIndex = armIndex++;
    elseRegion.source = elseSource;
    elseRegion.bodySource = generateStmtBodySource(false_stmt);
    elseRegion.groupSource = firstValidSource({groupSource, getSourceInfo(gen_handle)});
    const std::string elseIdLabel = appendBlockLabel("else", elseBlockLabel);
    elseRegion.label = generateArmDisplayLabel(elseBlockLabel, "else");
    elseRegion.id = generateRegionId(mod.name, elseRegion.kind, elseSource, elseRegion.armIndex, elseIdLabel);
    const size_t elseRegionIndex = mod.generateRegions.size();
    mod.generateRegions.push_back(elseRegion);

    std::set<vpiHandle> elseBodyVisited;
    collectGenerateRegionBody(false_stmt, mod, mod.generateRegions[elseRegionIndex], elseBodyVisited, depth + 1);
    const std::string elseRegionId = mod.generateRegions[elseRegionIndex].id;
    walkGenerateRegionTree(false_stmt, mod, elseRegionId, visited, depth + 1);
}

void DesignExtractor::collectGenerateCaseRegions(vpiHandle gen_handle, Module& mod, const std::string& parentRegionId, std::set<vpiHandle>& visited, int depth) {
    if (!gen_handle || depth > 128) return;

    vpiHandle selector_handle = vpi_handle(vpiCondition, gen_handle);
    const std::string selector = getExprText(selector_handle);
    SourceInfo source = getSourceInfo(gen_handle);
    // Keyword-less generate case: anchor the sibling group at the selector when the
    // case handle itself has no location (see collectGenerateIfRegions).
    const std::string groupId = generateGroupId(mod.name, "case", firstValidSource({source, getSourceInfo(selector_handle)}));

    vpiHandle item_itr = vpi_iterate(vpiCaseItem, gen_handle);
    if (!item_itr) return;

    int armIndex = 0;
    while (vpiHandle item = vpi_scan(item_itr)) {
        std::vector<vpiHandle> expr_handles;
        std::set<vpiHandle> seen_exprs;

        vpiHandle expr_itr = vpi_iterate(vpiExpr, item);
        if (expr_itr) {
            while (vpiHandle expr = vpi_scan(expr_itr)) {
                if (expr && !seen_exprs.count(expr)) {
                    expr_handles.push_back(expr);
                    seen_exprs.insert(expr);
                }
            }
            vpi_release_handle(expr_itr);
        }

        vpiHandle single_expr = vpi_handle(vpiExpr, item);
        if (single_expr && !seen_exprs.count(single_expr)) {
            expr_handles.push_back(single_expr);
            seen_exprs.insert(single_expr);
        }

        std::vector<std::string> values;
        std::vector<SourceInfo> expr_sources;
        for (vpiHandle expr : expr_handles) {
            std::string text = getExprText(expr);
            if (text.empty()) text = getSignalName(expr);
            if (!text.empty()) values.push_back(text);
            expr_sources.push_back(getSourceInfo(expr));
        }

        const bool isDefault = values.empty();
        const std::string caseValue = isDefault ? "default" : joinStrings(values, ", ");
        std::string condition;
        if (isDefault) {
            condition = "default";
        } else if (values.size() == 1) {
            condition = (selector.empty() ? "case" : selector) + " == " + values[0];
        } else {
            condition = (selector.empty() ? "case" : selector) + " in {" + caseValue + "}";
        }

        vpiHandle body = vpi_handle(vpiStmt, item);
        const std::string blockLabel = blockLabelForStmt(body);
        SourceInfo bodySource = generateStmtBodySource(body);
        // Note: bodySource is deliberately not an armSource candidate — armSource feeds
        // the region id, which must stay stable across bodySource improvements.
        std::vector<SourceInfo> sourceCandidates = expr_sources;
        sourceCandidates.push_back(getSourceInfo(item));
        sourceCandidates.push_back(source);
        SourceInfo armSource = firstValidSource(sourceCandidates);

        GenerateRegion region;
        region.kind = isDefault ? "case-default" : "case";
        region.condition = condition;
        region.selector = selector;
        region.caseValue = caseValue;
        region.blockLabel = blockLabel;
        region.fullBlockLabel = fullBlockLabelForStmt(body);
        region.parentRegionId = parentRegionId;
        region.siblingGroupId = groupId;
        region.armIndex = armIndex++;
        region.source = armSource;
        region.bodySource = bodySource;
        region.groupSource = source;
        const std::string idLabel = appendBlockLabel(condition, blockLabel);
        region.label = generateArmDisplayLabel(blockLabel, condition);
        region.id = generateRegionId(mod.name, region.kind, armSource, region.armIndex, idLabel);

        if (!body || !validSource(bodySource)) {
            region.warnings.push_back("UHDM did not provide a source-side body for this generate case item");
        }

        const size_t regionIndex = mod.generateRegions.size();
        mod.generateRegions.push_back(region);

        if (body) {
            std::set<vpiHandle> bodyVisited;
            collectGenerateRegionBody(body, mod, mod.generateRegions[regionIndex], bodyVisited, depth + 1);
            const std::string regionId = mod.generateRegions[regionIndex].id;
            walkGenerateRegionTree(body, mod, regionId, visited, depth + 1);
        }
    }
    vpi_release_handle(item_itr);
}

void DesignExtractor::collectGenerateRegionBody(vpiHandle handle, Module& mod, GenerateRegion& region, std::set<vpiHandle>& visited, int depth) {
    if (!handle || depth > 128) return;
    if (visited.count(handle)) return;
    visited.insert(handle);

    const int type = vpi_get(vpiType, handle);
    if (isGenerateConditionalType(type)) return;

    const char* raw_def_name = vpi_get_str(vpiDefName, handle);
    if (raw_def_name && strlen(raw_def_name) > 0) {
        processGenerateRegionInstance(handle, mod, region);
        return;
    }

    if (type == vpiContAssign) {
        processGenerateRegionAssign(handle, mod, region);
        return;
    }

    vpiHandle stmt = vpi_handle(vpiStmt, handle);
    if (stmt && stmt != handle) {
        collectGenerateRegionBody(stmt, mod, region, visited, depth + 1);
    }

    for (int iter_type : {vpiStmt, vpiCaseItem, vpiContAssign, vpiModule, 32, 33}) {
        vpiHandle itr = vpi_iterate(iter_type, handle);
        if (!itr) continue;
        while (vpiHandle child = vpi_scan(itr)) {
            if (!child || child == handle) continue;
            if (iter_type == vpiCaseItem) {
                vpiHandle item_stmt = vpi_handle(vpiStmt, child);
                if (item_stmt) collectGenerateRegionBody(item_stmt, mod, region, visited, depth + 1);
            } else {
                collectGenerateRegionBody(child, mod, region, visited, depth + 1);
            }
        }
        vpi_release_handle(itr);
    }

    vpiHandle else_stmt = vpi_handle(vpiElseStmt, handle);
    if (else_stmt && else_stmt != handle) {
        collectGenerateRegionBody(else_stmt, mod, region, visited, depth + 1);
    }
}

void DesignExtractor::processGenerateRegionInstance(vpiHandle inst_handle, Module& mod, GenerateRegion& region) {
    if (!inst_handle) return;

    const char* raw_name = vpi_get_str(vpiName, inst_handle);
    const char* raw_def = vpi_get_str(vpiDefName, inst_handle);
    std::string instanceName = raw_name ? raw_name : (raw_def ? raw_def : "instance");
    instanceName = generateStripWorkPrefix(instanceName);
    if (mod.interfaceSignals.count(instanceName)) return;

    std::string label = scopedGenerateLabel(region, lastNameComponent(instanceName));
    if (label.empty()) label = scopedGenerateLabel(region, "instance");

    Node node;
    node.id = sanitizeId("instance:" + mod.name + ":" + label);
    node.kind = "instance";
    node.label = label;
    if (raw_def) {
        std::string defName = generateStripWorkPrefix(raw_def);
        node.instanceOf = defName;
        node.moduleName = defName;
    }
    node.source = getSourceInfo(inst_handle);
    node.metadata.instanceParameters = collectInstanceParameters(inst_handle, mod);
    markGenerateOwned(node, region);

    auto findModulePortDecl = [&](const std::string& portName) -> std::optional<Port> {
        if (portName.empty() || node.moduleName.empty()) return std::nullopt;

        for (const auto& processed : modules_) {
            if (processed.name != node.moduleName) continue;
            for (const auto& declared : processed.ports) {
                if (declared.name == portName) return declared;
            }
        }

        if (!design_) return std::nullopt;
        const int uhdmallModules = 2008;
        vpiHandle mod_itr = vpi_iterate(uhdmallModules, design_);
        if (!mod_itr) return std::nullopt;

        std::optional<Port> result;
        while (vpiHandle module_handle = vpi_scan(mod_itr)) {
            if (result) break;
            const char* def_name = vpi_get_str(vpiDefName, module_handle);
            std::string moduleName = def_name ? generateStripWorkPrefix(def_name) : "";
            if (moduleName != node.moduleName) continue;

            vpiHandle port_decl_itr = vpi_iterate(vpiPort, module_handle);
            if (!port_decl_itr) continue;
            while (vpiHandle declared_handle = vpi_scan(port_decl_itr)) {
                const char* declared_name = vpi_get_str(vpiName, declared_handle);
                if (!declared_name || portName != declared_name) continue;

                Port declared;
                declared.name = portName;
                declared.direction = portDirectionString(vpi_get(vpiDirection, declared_handle));
                declared.source = getSourceInfo(declared_handle);
                vpiHandle low = vpi_handle(vpiLowConn, declared_handle);
                declared.width = getWidth(low ? low : declared_handle);
                if (declared.width.empty()) declared.width = "[0:0]";
                declared.widthExpression = getRangeExpression(low ? low : declared_handle);
                declared.typeName = getTypeName(low ? low : declared_handle);
                if (!declared.typeName.empty()) declared.typeSource = getTypeSource(low ? low : declared_handle);
                result = declared;
                break;
            }
            vpi_release_handle(port_decl_itr);
        }
        vpi_release_handle(mod_itr);
        return result;
    };

    vpiHandle port_itr = vpi_iterate(vpiPort, inst_handle);
    if (port_itr) {
        while (vpiHandle port_handle = vpi_scan(port_itr)) {
            NodePort port;
            const char* port_name = vpi_get_str(vpiName, port_handle);
            port.name = port_name ? port_name : "unnamed";
            port.direction = portDirectionString(vpi_get(vpiDirection, port_handle));
            std::optional<Port> declaredPort = findModulePortDecl(port.name);
            if (port.direction == "unknown" && declaredPort && !declaredPort->direction.empty()) {
                port.direction = declaredPort->direction;
            }

            vpiHandle high = vpi_handle(vpiHighConn, port_handle);
            vpiHandle low = vpi_handle(vpiLowConn, port_handle);
            port.signal = getSignalName(high);
            if (port.signal.empty()) port.signal = getSignalName(low);
            port.width = getWidth(low);
            if (port.width.empty() || port.width == "[0:0]") {
                std::string handleWidth = getWidth(port_handle);
                if (!handleWidth.empty() && handleWidth != "[0:0]") port.width = handleWidth;
            }
            if (port.width.empty() || port.width == "[0:0]") {
                std::string declaredWidth = getDeclaredSignalWidth(mod, port.signal.empty() ? port.name : port.signal);
                if (!declaredWidth.empty()) port.width = declaredWidth;
            }
            if ((port.width.empty() || port.width == "[0:0]") && declaredPort && !declaredPort->width.empty()) {
                port.width = declaredPort->width;
            }
            if (port.width.empty()) port.width = "[0:0]";

            port.widthExpression = getRangeExpression(low ? low : port_handle);
            if (port.widthExpression.empty() && declaredPort) port.widthExpression = declaredPort->widthExpression;
            if (port.widthExpression.empty() && std::regex_search(port.width, std::regex(R"([A-Za-z_$])"))) {
                port.widthExpression = port.width;
            }
            port.parameterRefs = collectParameterRefs(low ? low : port_handle, mod);
            port.source = getSourceInfo(high ? high : port_handle);

            if (auto field = getStructFieldRef(high, mod)) {
                const std::string fieldSignal = field->first + "." + field->second;
                if (port.direction == "input") {
                    port.signal = ensureStructBreakout(mod, field->first, field->second, getSourceInfo(high));
                } else if (port.direction == "output") {
                    port.signal = fieldSignal;
                    ensureStructFieldCompositionInput(mod, field->first, field->second, fieldSignal, getSourceInfo(high));
                }
                port.width = fieldWidth(mod.structSignals[field->first].type, field->second);
            }

            port.typeName = getTypeName(low);
            if (port.typeName.empty()) port.typeName = getTypeName(port_handle);
            if (port.typeName.empty() && declaredPort) port.typeName = declaredPort->typeName;
            if (!port.typeName.empty()) {
                port.typeSource = getTypeSource(low);
                if (port.typeSource.file.empty()) port.typeSource = getTypeSource(port_handle);
                if (port.typeSource.file.empty() && declaredPort) port.typeSource = declaredPort->typeSource;
            }

            if (auto iface = interfacePortInfoForModule(node.moduleName, port.name)) {
                port.typeName = iface->typeName;
                port.modportName = iface->modportName;
                auto type_it = interfaceTypes_.find(port.typeName);
                if (type_it != interfaceTypes_.end()) {
                    port.typeSource = type_it->second.source;
                    if (!port.modportName.empty()) {
                        auto mp_it = type_it->second.modports.find(port.modportName);
                        if (mp_it != type_it->second.modports.end()) {
                            port.modportSource = mp_it->second.source;
                            port.preferredSide = mp_it->second.preferredSide;
                            if (port.preferredSide == "left") {
                                port.direction = "output";
                            } else if (port.preferredSide == "right") {
                                port.direction = "input";
                            }
                        }
                    }
                }
            }

            node.ports.push_back(port);
        }
        vpi_release_handle(port_itr);
    }

    if (!findNodeById(mod, node.id)) {
        if (vpi_get(vpiType, inst_handle) == vpiModule && !node.instanceOf.empty()) {
            processModule(inst_handle);
        }
        mod.nodes.push_back(node);
    } else if (Node* existing = findNodeById(mod, node.id)) {
        markGenerateOwned(*existing, region);
    }
    pushUnique(region.nodeIds, node.id);
}

void DesignExtractor::processGenerateRegionAssign(vpiHandle assign_handle, Module& mod, GenerateRegion& region) {
    if (!assign_handle) return;
    vpiHandle lhs = vpi_handle(vpiLhs, assign_handle);
    vpiHandle rhs = vpi_handle(vpiRhs, assign_handle);
    if (!lhs || !rhs) return;

    const std::string outSignal = getSignalName(lhs);
    if (outSignal.empty()) return;
    std::string outBase = getBaseSignalName(lhs);
    if (outBase.empty()) outBase = outSignal;

    std::string outWidth = getWidth(lhs);
    std::string declaredWidth = getDeclaredSignalWidth(mod, outBase);
    if (!declaredWidth.empty() && bitSizeFromWidth(declaredWidth) > bitSizeFromWidth(outWidth)) {
        outWidth = declaredWidth;
    }
    if (outWidth.empty()) outWidth = "[0:0]";

    const SourceInfo source = getSourceInfo(assign_handle);
    const std::string rhsText = getAssignmentRhsText(assign_handle);

    if (isLiteralExpr(rhs)) {
        std::string label = rhsText.empty() ? getLiteralLabel(rhs) : rhsText;
        if (label.empty()) label = outSignal;

        Node node;
        node.id = sanitizeId("literal:" + mod.name + ":" + region.id + ":" + outSignal + ":" + label);
        node.kind = "literal";
        node.label = label;
        node.source = source;
        markGenerateOwned(node, region);
        node.ports.push_back({outSignal, "output", outSignal, outWidth, "", source});

        if (!findNodeById(mod, node.id)) {
            mod.nodes.push_back(node);
        } else if (Node* existing = findNodeById(mod, node.id)) {
            markGenerateOwned(*existing, region);
        }
        pushUnique(region.nodeIds, node.id);
        return;
    }

    int rhsType = vpi_get(vpiType, rhs);
    bool shouldPromoteRhs = (rhsType == vpiOperation);
    std::string inSignal = shouldPromoteRhs ? "" : getSignalName(rhs);
    if (inSignal.empty() || inSignal == "expr") {
        const size_t before = mod.nodes.size();
        inSignal = getOrPromoteExpr(rhs, mod, sanitizeId(region.blockLabel + "_" + outSignal + "_src"), false);
        bool promotedOutputRetargeted = false;
        for (size_t i = before; i < mod.nodes.size(); ++i) {
            markGenerateOwned(mod.nodes[i], region);
            pushUnique(region.nodeIds, mod.nodes[i].id);
            for (auto& port : mod.nodes[i].ports) {
                if (port.direction == "output" && port.signal == inSignal) {
                    port.signal = outSignal;
                    if (mod.nodes[i].kind == "mux") {
                        port.name = "out";
                        port.label = "";
                    } else {
                        port.name = outSignal;
                        port.label = outSignal;
                    }
                    if (bitSizeFromWidth(outWidth) > bitSizeFromWidth(port.width)) {
                        port.width = outWidth;
                    }
                    promotedOutputRetargeted = true;
                }
            }
        }
        if (promotedOutputRetargeted) {
            return;
        }
    }
    if (inSignal.empty() || inSignal == outSignal) return;

    Node node;
    node.id = sanitizeId("comb:" + mod.name + ":" + region.id + ":" + outSignal + ":assign");
    node.kind = "comb";
    node.label = "";
    node.source = source;
    node.metadata.expression = rhsText.empty() ? inSignal : rhsText;
    markGenerateOwned(node, region);
    node.ports.push_back({outSignal, "output", outSignal, outWidth, outSignal, source});

    std::string inName = inSignal;
    std::string inLabel;
    size_t bracket = inSignal.find('[');
    if (bracket != std::string::npos) {
        inName = inSignal.substr(0, bracket);
        inLabel = inSignal.substr(bracket);
    }
    std::string inWidth = getWidth(rhs);
    if (inWidth.empty()) {
        std::string declaredInWidth = getDeclaredSignalWidth(mod, getBaseSignalName(rhs));
        if (!declaredInWidth.empty()) inWidth = declaredInWidth;
    }
    node.ports.push_back({inName, "input", inSignal, inWidth, inLabel, getSourceInfo(rhs)});

    if (!findNodeById(mod, node.id)) {
        mod.nodes.push_back(node);
    } else if (Node* existing = findNodeById(mod, node.id)) {
        markGenerateOwned(*existing, region);
    }
    pushUnique(region.nodeIds, node.id);
}

void DesignExtractor::tagGenerateRegionEdges(Module& mod) {
    struct RegionTag {
        std::string id;
        std::string activeState;
    };

    std::map<std::string, RegionTag> regionByNode;
    for (const auto& region : mod.generateRegions) {
        for (const auto& nodeId : region.nodeIds) {
            if (!nodeId.empty() && !regionByNode.count(nodeId)) {
                regionByNode[nodeId] = {region.id, region.activeState};
            }
        }
    }

    for (const auto& node : mod.nodes) {
        if (!node.metadata.generateRegionId.empty() && !regionByNode.count(node.id)) {
            regionByNode[node.id] = {node.metadata.generateRegionId, node.metadata.generateActiveState};
        }
    }

    for (auto& edge : mod.edges) {
        auto sourceRegion = regionByNode.find(edge.source);
        auto targetRegion = regionByNode.find(edge.target);
        if (sourceRegion != regionByNode.end()) {
            edge.generateRegionId = sourceRegion->second.id;
            edge.generateActiveState = sourceRegion->second.activeState;
        } else if (targetRegion != regionByNode.end()) {
            edge.generateRegionId = targetRegion->second.id;
            edge.generateActiveState = targetRegion->second.activeState;
        }
    }
}
