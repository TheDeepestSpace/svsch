# Generate If/Case Region Support

## Summary

Add v1 support for module-level conditional generate blocks: `if`/`else if`/`else` and `case`/`casez`/`casex`, both inside explicit `generate/endgenerate` and as implicit generate constructs. Procedural `if`/`case` inside `always_*`, `initial`, tasks, or functions remains unchanged. Generate `for` is explicitly out of scope for v1.

The implementation should be C++/UHDM-first. Surelog/UHDM already gives us the source-side conditional tree for generate `if` and, generally, generate `case`. We should avoid TypeScript/raw-source parsing except for narrow display/source fallback cases already used elsewhere in the extractor.

All source arms are represented as dashed condition rectangles. Arm contents are conditional subgraphs: active arms render normally, inactive arms render subdued/greyed with dashed or low-contrast connections. This lets the user see inactive hardware possibilities without implying that mutually exclusive arms are simultaneously driving the same nets.

## UHDM Findings

- `_gen_if_else` is the source-side generate-if object.
  - It has `vpiCondition`, `vpiStmt` for the true arm, and `vpiElseStmt` for the else arm.
  - `else if` is represented as a nested `_gen_if_else`.
  - Folded UHDM preserved all tested `if / else if / else` arm bodies.
- `_gen_case` is the source-side generate-case object.
  - It has `vpiCondition` and `case_item` children.
  - Each `case_item` has expressions and a `vpiStmt` body.
  - Single-label case arms preserved all tested arm bodies, including inactive arms, nested cases, implicit generate cases, unnamed bodies, and child modules with defaults/overrides.
- `_gen_scope_array` is the selected elaborated generated scope.
  - It should be used in v1 mainly to identify the active path for the current parameterization.
  - Do not use it as the primary source of schematic structure in v1; otherwise changing only a parameter can structurally reshuffle/unfuse the diagram.
  - It remains useful for active-state marking, resolved full hierarchy names, generated names such as `genblk1`, and fallback diagnostics.
- Known Surelog/UHDM 1.84 caveat:
  - Multi-label generate case items such as `1, 2: begin : g_case_12 ... end` can drop the multi-label arm body from the folded `_gen_case`.
  - The active selected arm may still appear under `_gen_scope_array`.
  - Treat this as a known warning/fallback case for v1 rather than a blocker for single-label case support.
- Invalid unbound generate parameters, such as a no-default top-level parameter with no override, can still produce a UHDM file but with Surelog errors and unreliable selected scopes. Do not trust active-path inference for those cases.

## Public Interfaces

- Extend the IR with `GenerateRegion` on `DesignModule`:
  - `id`
  - `kind: 'if' | 'case'`
  - `label`
  - `condition`
  - `blockLabel?`
  - `displayName`
  - `source`
  - `bodySource`
  - `parentRegionId?`
  - `siblingGroupId`
  - `nodeIds`
  - `edgeIds?`
  - `active?: boolean`
  - `activeState?: 'active' | 'inactive' | 'unknown'`
  - `warnings?: string[]`
- Region labels/display names should include the named generate block label when available.
  - Example: `MODE == 0 (g_case_0)` or `g_case_0: MODE == 0`.
  - Example: `default (g_case_default)`.
  - Example: `ENABLE (g_if_yes)`.
  - If no label exists, fall back to the condition/default text and, if available, the generated name such as `genblk1`.
- Extend node/edge metadata with optional conditional-region ownership:
  - `generateRegionId?: string`
  - `generateActiveState?: 'active' | 'inactive' | 'unknown'`
  - This supports greyed inactive blocks and dashed inactive nets without changing normal active schematic semantics.
- Extend `DiagramViewModel` with positioned regions:
  - `generateRegions?: PositionedGenerateRegion[]`
  - Each includes `bounds: { x, y, width, height }`, `nodeIds`, `edgeIds`, active state, and computed warning ids.
- Extend saved layout with optional per-module region geometry:
  - `SavedModuleLayout.regions?: Record<string, { x; y; width; height; fixed?: boolean; stale?: boolean }>`
  - Keep layout `version: 1`; old layouts remain valid.
- Extend webview messages:
  - `layoutChanged` accepts optional `regions`.
  - Add `regionLayoutChanged` for resize-only changes.

## Implementation Changes

- Replace the current generic C++ generate placeholder with real UHDM generate extraction.
  - Current placeholder is the `unknown:generate` emission from module-level `vpiGenStmt`/`vpiGenCase`/`vpiGenIfElse` iteration.
  - Remove or filter that placeholder once real regions are emitted.
- Add C++ UHDM traversal for source-side generate regions.
  - Walk module-level `_gen_if_else` and `_gen_case` objects, including those nested inside generate arm bodies.
  - Flatten `else if` chains into sibling arm regions while preserving the nested UHDM relationship internally if useful.
  - Parse case arms from `case_item` expressions plus `vpiStmt`.
  - Skip generate `for` in v1, but emit a diagnostic/unsupported region marker if that helps users understand missing content.
- Build conditional arm schematics from source-side arm bodies.
  - Reuse/generalize existing instance, continuous assignment, and expression-processing helpers so they can operate on arbitrary `vpiStmt` containers, not only direct module children.
  - Tag every node/edge produced from an arm body with its `generateRegionId` and active state.
  - Shared module ports and external dependencies remain outside the region; conditional edges may connect region-owned nodes to outside signals.
  - Inactive-arm edges should be marked conditional/inactive so the UI does not present mutually exclusive branches as simultaneous active drivers.
- Use `_gen_scope_array` only as active-path metadata in v1.
  - Match active generated scope names/source ranges back to source regions.
  - If only a parameter value changes, keep the source-derived region graph stable and update active/inactive highlighting.
  - If active matching fails, leave active state as `unknown` and render all arms in neutral conditional styling.
- Handle known caveats.
  - Multi-label case items: detect empty/missing `vpiStmt` bodies where source appears to have a named block; warn and fall back to active `_gen_scope_array` only for the selected arm if possible.
  - Invalid Surelog runs: do not mark a path active from partial/error elaboration.
  - Unnamed generate bodies: use source condition as display name, with generated `genblkN` if UHDM exposes it.
- Add region geometry helpers.
  - Region auto bounds are the union of owned node rectangles inflated by one grid snap.
  - Empty/source-only arms get a minimum placeholder rectangle, stacked with sibling arms in source order.
  - Saved bounds never shrink automatically. If owned nodes move outside saved bounds, expand only the necessary sides.
  - Owned nodes must remain at least one grid snap inside the region during user resize.
- Render and interact in the webview.
  - Add a non-node overlay inside the React Flow viewport so rectangles do not affect graph routing, selection, or minimap.
  - Render dashed rectangles behind blocks, with top-left labels just above the border.
  - Render inactive-region nodes/edges subdued; use dashed or lower-opacity nets for inactive conditional connections.
  - Add four side resize handles, snapped to the grid and clamped by owned-node containment.
  - On node drag, live-expand owned regions when needed; on drag stop, persist nodes plus changed regions.
  - Allow dragging the arm region itself; moving a region moves all owned blocks by the same delta, as if the owned blocks were selected together.
  - Allow external nodes to enter a region, but mark the region and intruding node red and show a note: `Block does not belong to <condition>`.
  - Mark sibling/unrelated region overlaps red; ignore ancestor/descendant overlap.
- Update SVG export.
  - Render `generateRegions` before edges and nodes in the CLI/export SVG path.
  - Include region bounds in SVG diagram bounds so exported images are not clipped.
  - Preserve active/inactive styling in exported SVG.

## Test Plan

- Fixtures:
  - Generate `if / else`.
  - Generate `if / else if / else`.
  - Generate `case` with single-label arms and default.
  - Implicit generate `if` and `case`.
  - Nested `if -> if`, `case -> case`, `if -> case`, and `case -> if`.
  - Inactive-arm source contents with module instances and assignments.
  - Unnamed generate arms.
  - Multi-label generate case as a known caveat fixture.
  - Procedural `always_comb/_latch/_ff` if/case control fixtures.
- Unit tests:
  - C++ UHDM extraction emits all source arms for supported generate `if` and single-label `case`.
  - Region display names include named block labels such as `g_case_0`, `g_if_yes`, and `g_case_default` when present.
  - `_gen_scope_array` changes only active/inactive state, not source-derived region/node structure.
  - Inactive arm nodes and edges are tagged conditional/inactive.
  - Procedural `always_comb/_latch/_ff` if/case creates no generate regions.
  - Region membership excludes external ports and includes helper/literal/expression nodes sourced inside an arm.
  - Nested parent/child regions are allowed; sibling overlap is detected.
  - Multi-label case item fixture emits a warning or partial-support diagnostic.
  - Geometry helpers enforce one-grid containment, no auto-shrink, auto-expand, and placeholder bounds.
- Visual and interaction tests:
  - Dashed labels render for if/case arms, including empty arms.
  - Block labels appear in region titles when available.
  - Inactive blocks and inactive conditional nets are visibly subdued/dashed.
  - Changing active branch restyles the regions without changing saved geometry.
  - Dragging an owned block outward expands its rectangle and persists.
  - Dragging it inward does not shrink the rectangle.
  - Dragging a region moves all blocks owned by that arm together.
  - Resizing a side is clamped before owned blocks leave the one-grid inset.
  - Dragging an external block into a region shows the red warning note.
  - Overlapping sibling regions turn red.
- BDD scenarios:
  - Observing generate if/case regions.
  - Observing inactive arms as conditional greyed schematics.
  - Changing a parameter highlights a different active path without structural churn.
  - Moving owned blocks expands regions.
  - Resizing regions preserves containment.
  - External intrusion and sibling overlap warnings appear.
- Verification commands:
  - `npm run compile:backend`
  - `npm run lint`
  - Targeted Vitest UHDM region extraction/layout tests.
  - Targeted Playwright visual tests.
  - Targeted BDD feature scenarios.
