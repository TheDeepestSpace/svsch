# Visual Cut Nets With Editable Labels

## Summary

Add layout-only support for cutting a whole routed net into labeled stubs. A cut applies to the clicked net's source endpoint and all current sinks. The HDL remains read-only; cuts, names, and moved label positions live in `.svsch/layout.json`.

## Public Interfaces And Saved State

- Extend `SavedModuleLayout` with optional `netCuts?: Record<netKey, { label: string; source: { nodeId: string; portId?: string } }>` while keeping layout `version: 1`.
- Add view-only node kind `netLabel` to `DiagramNodeKind`.
- Add metadata:
  - `DiagramNodeMetadata.cutNet?: { netKey; role: 'source' | 'sink'; align: 'start' | 'end'; originalEdgeId?: string; handleSide: 'left' | 'right' | 'top' | 'bottom' }`
  - `DiagramEdgeMetadata.cutStub?: { netKey; role: 'source' | 'sink'; originalEdgeId?: string }`
  - type existing `metadata.forceStraight?: boolean`
- Add webview messages: `cutNet`, `renameCutNet`, `tieNet`.
- Add shared `edgeNetKey(edge)` helper so layout, webview, and edge rendering use the same net grouping.

## Implementation Changes

- In `buildViewModel`, before routing, remove edges whose `edgeNetKey` is active in `moduleLayout.netCuts`; those nets no longer participate in reroute.
- On cut, freeze current node positions first so cutting a net does not cause the graph to jump.
- Project each active cut into synthetic `netLabel` nodes:
  - one source label node per cut net
  - one sink label node per original sink edge
  - deterministic ids like `cut-label:<netKey>:source` and `cut-label:<netKey>:sink:<edgeId>`
- Add synthetic stub edges:
  - source stub: original source endpoint to source label node
  - sink stub: sink label node to original target endpoint
  - inherit visual metadata such as struct/interface/stacked styling, plus `cutStub`
  - set `forceStraight` for clean lead-to-label segments
- Render `netLabel` nodes in `HdlNode` as compact draggable labels with a small internal wire line:
  - source labels use right/end text alignment
  - sink labels use left/start text alignment
  - top/bottom endpoints are supported by placing the label outward from the endpoint and using a centered vertical handle
- Add a scissors button as a small `foreignObject` in `OrthogonalEdge` when hovering an uncut routed edge. Clicking it sends `cutNet` for the whole net.
- Add inline edit on double-clicking a cut label. `Enter` or blur commits `renameCutNet`; `Escape` cancels. Empty names are rejected.
- Add a compact tie-back button on each cut label. Clicking any label's tie button removes the whole cut net and restores all original routed edges.
- Preserve existing manual routes for hidden original edges while cut. If the user reroutes while cut, current `mergeRerouteLayout` clears routes, so tying back later produces fresh ELK routes.
- Reset Layout continues to delete the module layout, so it removes cuts, labels, moved label positions, and manual routes together.

## Naming Rules

- Default label priority:
  - top-level input/source port: port label/name, for example `clk`
  - instance output: `instanceName.portName`, for example `u_alu.result`
  - register/latch output: register signal label or output port connected signal
  - bus/struct/interface source: edge signal or source port connected signal
  - anonymous/generated sources such as comb, loop, mux/select, alu, inverter, literal, unknown: `NET_<n>`
- `NET_<n>` is allocated per module using the lowest unused positive integer among current cut labels.
- Custom labels are trimmed and stored exactly as visual names. They do not rewrite HDL and do not merge unrelated nets by name.

## Edge Cases

- If a cut net's topology changes after a rebuild, the saved cut applies to all current edges with the same source endpoint key. Removed sink label nodes become inactive; new sinks get new label nodes with the same net label.
- If the source endpoint disappears, the cut is ignored but left dormant in layout state so it can reappear if the endpoint returns.
- Cutting an already cut net is a no-op.
- Tying back removes the saved `netCut` plus associated synthetic label node and stub edge layout entries.
- Existing net hover highlighting should group all stubs of the same cut net, but no scissors button appears on already cut stubs.

## Test Plan

- Unit tests for `edgeNetKey`, default label generation, `mergeNetCut`, `renameCutNet`, `removeNetCut`, and reroute preservation of `netCuts`.
- `buildViewModel` tests for fanout cuts: original edges suppressed, one source label plus all sink labels created, stub metadata present, and original net absent from routed edges.
- Interaction or BDD test: hover wire, click scissors, see all labels; rename one label and verify all labels update; tie back and verify original edge ids return.
- Visual regression: fanout cut with moved labels, reroute while cut, struct/interface or stacked-net stub styling.
- Run `npm run lint`, `npm run test`, and targeted Playwright visual tests.

