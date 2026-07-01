# Plan: consistent ≥1-grid padding around every block (and wires that respect it)

## Goal

Guarantee that in **auto-generated** layouts (initial view, "Reset Layout",
"Reroute All") every block keeps at least **one grid-snap (`gridSize` = 24px)**
of clear space on all sides from every other block, and that wires keep the same
clearance from blocks they don't terminate on. Overlapping padding is fine — the
target is a *minimum* 1-grid gap between any two block edges, not 2× padding.

## Observed symptom

In `navigating-to-io-port-declarations--01--viewing-module-top.png` the `a`
(output) and `b [3:0]` (input) IO-port blocks are flush against each other
vertically, while `b` and `c` happen to sit one grid apart. The module `top` has
only IO declarations and **no internal logic**, so there are **no edges** — node
placement comes straight from ELK + snapping, with no gap repair applied to port
nodes.

## Root causes (all in `src/layout/mergeLayout.ts`)

1. **Port/literal/replicate nodes are exempt from the min-gap pass.**
   `enforceMinimumBlockGaps` ([mergeLayout.ts:879](../src/layout/mergeLayout.ts#L879))
   already enforces a 1-grid vertical gap (`minGap = diagramSizing.gridSize`,
   [:887](../src/layout/mergeLayout.ts#L887)) between overlapping blocks — but it
   only operates on `isBlockSpacingNode`, which excludes `port`, `literal`,
   `replicate` ([:921-923](../src/layout/mergeLayout.ts#L921-L923)). IO ports are
   `kind: 'port'`, so they get **zero** gap enforcement. This is the direct cause
   of the `a`/`b` jam.

2. **The min-gap pass is vertical-only and one-directional.** It sorts by `y`
   and only ever pushes nodes *down* when they vertically collide within a
   shared horizontal span ([:888-918](../src/layout/mergeLayout.ts#L888-L918)).
   Horizontal clearance is left entirely to ELK's
   `elk.layered.spacing.nodeNodeBetweenLayers` (= `minNodeSeparation`, 7 grids)
   and same-layer `elk.spacing.nodeNode` (= `sameLayerNodeSeparation`, 1 grid)
   ([:381-382](../src/layout/mergeLayout.ts#L381-L382)). That's usually generous,
   but it is not a guarantee after snapping, and breaks down for same-layer /
   no-edge cases like module `top`.

3. **Wire routing lets wires hug block edges.** Obstacle hit-testing
   (`segmentIntersectsRectInterior`,
   [:1267](../src/layout/mergeLayout.ts#L1267)) only rejects a route when it
   crosses a node's *interior* (epsilon 0.5px). A wire running exactly along a
   block's outer edge passes the test, so post-ELK repairs
   (`repairForwardHorizontalRoute`, `directLeadRoute`, `repairSourceStem`) may
   place segments flush against a block. ELK's own routing respects
   `elk.layered.spacing.edgeNode` (= 1 grid,
   [:389](../src/layout/mergeLayout.ts#L389)), but our fallback/repair geometry
   does not.

## Design

Keep `minGap = gridSize` everywhere (matches "overlapping padding is fine"). Make
the existing machinery apply to *all* drawn blocks and to wires.

### Change 1 — include all visible blocks in the gap pass

- Replace `isBlockSpacingNode` so it includes `port` (and `literal`,
  `replicate`). The only nodes to keep excluding are non-visual/zero-footprint
  ones, if any. Net cut labels (`netLabel`) are positioned separately and should
  stay out of the pass.
- **Interaction with `alignSimpleLeafNodes`** ([:791](../src/layout/mergeLayout.ts#L791)):
  current order is `align → enforceGaps → align`
  ([:432-434](../src/layout/mergeLayout.ts#L432-L434)). Alignment snaps a
  single-edge port to its peer's port `y` (different column ⇒ no horizontal
  overlap ⇒ gap pass won't touch it, which is correct). Two ports sharing a
  column at the same `y` is exactly the jam we want broken. Keep the final
  `align` but re-run `enforceMinimumBlockGaps` **after** it so spacing is
  authoritative; verify alignment-driven straight wires aren't regressed by the
  extra pass (they shouldn't be, since aligned ports live in separate columns).

### Change 2 — enforce horizontal clearance too

- Generalize the gap pass into a single separation pass that resolves overlaps
  on **both** axes: for any two blocks whose inflated (by `minGap`) rects
  overlap, push them apart along the axis of least penetration, then re-snap.
  Iterate to a fixed point (the existing `pass < blocks.length` loop structure
  already does bounded iteration). Bias horizontal pushes away from x=0 / toward
  preserving ELK's left-to-right layering so columns don't collapse.
- Cheaper alternative if a full 2-axis solver is overkill: add a symmetric
  horizontal variant of the current vertical pass (sort by `x`, push right on
  vertical overlap) run alongside the vertical one. Pick this unless tests show
  diagonal cases slipping through.

### Change 3 — wires respect the padding

- Inflate obstacle rectangles by `minGap` when testing whether a *route* is
  acceptable. Concretely, give `routeObstacles`
  ([:1251](../src/layout/mergeLayout.ts#L1251)) /
  `routeIntersectsNodeInterior` an inflation parameter and expand each rect by
  `gridSize` on all sides before the interior test.
- **Must exclude the edge's own source/target nodes from inflation** (or from
  the obstacle set for that edge), otherwise every lead — which legitimately
  starts on a block edge and travels `edgeLeadLength` (1 grid) outward before
  turning — would be reported as colliding with its own endpoint block. The lead
  geometry already steps 1 grid clear, so excluding endpoints keeps leads valid
  while still pushing *through-routes* a grid away from *other* blocks.
- The lane-finding fallback `forwardHorizontalCandidates`
  ([:1183](../src/layout/mergeLayout.ts#L1183)) already offsets lanes by
  `gridSize` past obstacle edges ([:1212-1213](../src/layout/mergeLayout.ts#L1212-L1213)),
  so it stays consistent with the inflated obstacles — good.

## Scope / non-goals

- Applies to auto-layout only. **User-dragged (`fixed`) nodes are intentionally
  preserved** — the gap pass already skips `moduleLayout.nodes[id]?.fixed`
  ([:884](../src/layout/mergeLayout.ts#L884)); keep that. (If we later want drag
  to also snap-with-clearance, that's a separate webview change.)
- No change to grid size, ELK algorithm choice, or net-cut label placement.

## Validation

1. **Unit** — `test/unit/mergeLayout.test.ts`: add a no-edge multi-port module
   (mirrors `top`) and assert every pair of blocks has ≥`gridSize` clearance on
   the overlapping axis. Add a routing case asserting no route segment runs
   within `gridSize` of a non-endpoint block. Re-run existing suite
   (`npm test`) — `branchedNetRouting.test.ts` and the position-preservation /
   snap tests are the likely sensitives.
2. **BDD/visual snapshots** — positions will shift, so regenerate:
   `npm run test:bdd:update` (and `test:visual:update` if affected). Review the
   `navigating-to-io-port-declarations` PNGs to confirm `a`/`b`/`c` now sit a
   grid apart.
3. **Manual** — open module `top` and a logic-heavy module (e.g. the
   array-register fixture) via `/run`; confirm clearance and that wires no longer
   hug blocks, with no new diagonal overlaps.

## Where to implement

Decide target branch before coding:
- **`master`** — this is a general layout-quality fix, independent of the
  `generate-block-regions` worktree (that branch adds SystemVerilog *generate
  region* boxes and only shares the screenshot, not the cause).
- Recommend implementing on `master` (or a fresh branch off it) so the
  `generate-block-regions` work can rebase on top and have its region bounds
  computed from already-padded node positions.
