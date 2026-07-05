# Fanout routes backtrack at interface top-hat anchors

Status: investigated, not fixed (2026-07-05). Reproducer baseline:
`test/visual/__screenshots__/interface.visual.spec.ts-snapshots/interface-dual-modport-bridge-top-canvas.svg`
(the clk connection into the `upstream` interface's top hat).

## Symptom

The clk wire into the upstream interface hat draws an S-squiggle above the
hat. The stored route (flow coords; upstream box top y=72, hat top y=108,
clk port row y=96):

```
M 144 96  L 480 96      trunk runs at the clk port's row (y=96)
L 480 72                climbs UP to the ELK anchor at the box top
L 480 89 Q … L 480 108  rendered lead comes back DOWN to the hat,
                        line-jump arc hops over its own trunk at y=96
```

The route physically backtracks 96 → 72 → 108 at the same x; the "wire
crossing" arc is the line-jump renderer hopping the lead over its own
approach trunk. The same trunk also pierces the `u_bridge` instance box on
its way to the downstream interface (hidden behind the box fill in the PNG).

## Root causes (three interacting)

1. **Fanout nets don't get real ELK routes.** `clk`/`rst_n` feed both
   interface hats. The FIXED-position routing pass is fragile for fanout
   hyperedges (see the retry comment in `autoLayoutMissingNodes`,
   `src/layout/mergeLayout.ts`). No projected ELK route survives for these
   edges, so they fall back to `directRenderedLeadRoute` — a naive L-shape
   (horizontal at source y, vertical at target x, ending at the anchor).
   Evidence it is this exact path: `routeWithRenderedLeads` has a
   port→NORTH shortcut that ends at the *inset handle* (y=84 here), but the
   stored route ends at y=72 — the with-margins anchor — which only
   `directRenderedLeadRoute` produces. 1:1 edges in the same diagram (e.g.
   upstream→u_bridge) get proper routes.

2. **The fallback is obstacle-blind.** The naive L-route ignores node boxes
   entirely (pierces the upstream corridor and the u_bridge instance). The
   webview's `avoidFeedbackObstacles` is skipped whenever `routePoints`
   are present.

3. **Box-top anchors create an unenforced keep-out band.** Interface
   top-hat anchors sit at the box top with the hat 1.5 grids below. Any
   horizontal approach arriving *between* those heights must go up to the
   anchor and back down. ELK-planned routes approach NORTH anchors from
   above by construction; the naive fallback does not, and placement has no
   constraint keeping source port rows out of the band (clk port center 96
   landed inside upstream's 72..108 corridor). Pre-existing fragility, made
   more likely by the tighter interface boxes. Note rst_n is fine — its
   trunk (y=48) is above the box top, so it descends monotonically; its
   small hop is a legitimate crossing over the clk trunk.

## Recommendations (in order of leverage)

1. **Make the fallback NORTH/SOUTH-aware** — in `directRenderedLeadRoute`
   (and the webview default route), when the target side is NORTH and the
   source y is below the anchor, route via a horizontal at `anchor.y` (or
   `boxTop − grid`) before the final drop. Kills the backtrack for all such
   edges; cheap and local. Mirror for SOUTH.
2. **Give fanout edges real routes** — find out why `projectElkRoutes`
   drops these hyperedge routes even in the individual-edge retry; fixing
   that also stops trunks piercing node boxes.
3. **Placement constraint (heavier)** — bias port-row placement away from
   interface top corridors, e.g. by modeling the corridor in the ELK node
   size for the placement pass only.
