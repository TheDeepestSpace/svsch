# svsch

## 0.2.1

### Patch Changes

- 35dfe69: Fail BDD snapshot/screenshot comparisons in CI when a baseline is missing instead of silently writing the actual output as the new baseline and passing. This previously let scenarios with no committed baseline pass vacuously. Local runs and `UPDATE_SNAPSHOTS=true` still auto-create baselines as before.
- 486d4e3: Fix edges intermittently failing to render (no `.react-flow__edge` DOM elements, timing out in CI) right after opening a module. React Flow only learns a node's handle positions from a `ResizeObserver` callback that fires on its own, browser-scheduled timing after the node's DOM mounts — under a busy renderer that callback can be delayed arbitrarily, during which no edges can be drawn even though the node/edge data model is already complete. Since the node/handle geometry is already valid the instant the DOM commits (layout doesn't require a paint), the webview now measures it synchronously itself right after nodes mount, instead of waiting on that observer's own scheduling.
- 64a4f1d: Simplify obstacle-safe Libavoid doglegs without adding crossings or shared-path overlap.

## 0.2.0

### Minor Changes

- bebd5fb: CLI: log which layout file (if any) was used for each rendered SVG, e.g. `[svsch] rendering out.svg using layout file .svsch/layouts/top.json` or `[svsch] rendering out.svg without a layout file`. Add a `--svsch-data-dir <dir>` flag so a module's per-module layout under `<dir>/layouts/<module>.json` can be found without spelling out the full path — useful now that layouts live one file per module under `.svsch/layouts/`.
- a6894fd: Route automatically laid-out schematic connections with libavoid, preserving
  orthogonal routes while avoiding diagram nodes and generate-region boundaries.
- 13e558f: Add wire and block selection operations to the diagram: drag-selected wires are now highlighted, Cut/Reroute controls act on an entire multi-wire selection at once (with a hover preview of what will be affected), and a new "Auto Layout" control re-places and reroutes just the selected blocks while leaving the rest of the diagram untouched.
- 88fbb15: Store each module's diagram layout in its own file under `.svsch/layouts/<module>.json` instead of one monolithic `.svsch/layout.json`. This avoids Git merge conflicts when different developers edit different modules' layouts, and keeps every read/write scoped to the module that actually changed instead of the whole project's layout data.

  This is a breaking change to the on-disk layout format: existing `.svsch/layout.json` files are no longer read, so saved node/edge/region positions will reset the first time you open a diagram after upgrading.

- ac53db5: Assign chains (`wire a, b, c; assign a = b; assign b = c; ...`) now report the earliest-declared internal wire/reg name in the chain (preferred over any port it aliases through), with every other internal name it collapsed through available on hover — names that just repeat one of that wire's own two endpoint ports are left out, since those are already visible as the blocks on either side. An ordinary, uncut wire now shows this declared name directly whenever it differs from both of its endpoints — e.g. `wire x; assign x = a; assign y = x;` labels the wire "x" — since otherwise that name would never appear anywhere in the diagram, and a fanout net (one source, many sinks) gets exactly one label, placed near its source instead of duplicated on every branch. Cut-net labels prefer a net's real SV-declared name over a guessed one; a label backed by a real declared name can never be renamed, while a tool-invented label (e.g. `NET_3`) stays freely renameable. Either way, the label renders in regular type right after the cut — since its default text is still the net's legitimate current name — and only switches to italic once the user actively renames it away from that default, with a "Revert label" button to restore it.

  Also fixes a routing bug where a freshly auto-routed wire connecting two ports at the same height could render with a spurious few-pixel notch instead of a flat, straight line, whenever that shared height wasn't itself grid-aligned.

### Patch Changes

- f4ab0d4: Fix "Auto Layout" so a cut net's dangling wire end moves along with the block it's attached to instead of staying stuck at a stale position. Selecting the block (or just its stub wire) now releases the dangling end too, even if the marquee didn't cover it directly; a dangling end whose wire isn't selected is left untouched.
- d069302: Bump elkjs from 0.11.1 to 0.12.0
- 96c2583: Bump typescript from 6.0.3 to 7.0.2
- 6346774: chore(deps-dev): bump jsdom from 29.1.1 to 30.0.0
- 67fa330: chore(deps-dev): bump @playwright/test from 1.61.1 to 1.62.0
- 971e524: Fix Dependabot changeset check logic in GitHub Actions workflow to check for specific PR changeset instead of any markdown file in .changeset.
- b1a001c: Fix flaky BDD test predicate in `_waitForRenderedModule` to support arbitrary path selectors and robust edge element verification.
- 83c77c2: Fix querySelector selector syntax error flakiness in BDD test step `_waitForRenderedModule` on edge IDs containing special characters.
- 18b96eb: Capture diagnostic node/edge state when the BDD `_waitForRenderedModule` render-completion check times out, so a recurrence of the intermittent "Navigating to combinational blocks" CI timeout is diagnosable from logs instead of a bare timeout.
- bddc998: Fix exported/generated SVGs being malformed XML: a couple of source comments in the embedded stylesheet contained literal `<...>` tag references, which is invalid inside an SVG `<style>` element without CDATA wrapping. Browsers render it anyway, but strict XML consumers (e.g. GitHub's SVG preview) rejected the whole file.
- dede9cc: Fix npm audit vulnerabilities in dependencies fast-uri and linkify-it.
- bd33eed: Enforce global exclusive Playwright suite locking, syntax test orchestration, per-worktree port/directory isolation, and config file mtime checking for incremental builds.
- b18738c: Fix Validate Changeset workflow to skip checking version package release PRs.
- 878666e: Render breakout and composition nodes as vertical bars on the minimap instead of rectangles.
- f4e0bb6: Fix npm audit vulnerabilities for brace-expansion, js-yaml, nanoid, and postcss.
- 16e8885: Setup Changesets versioning and automated CI/CD publishing workflows for NPM and VS Code Marketplace.
