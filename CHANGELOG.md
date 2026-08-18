# svsch

## 0.3.0

### Minor Changes

- 5f7864e: Add first-class boolean gate nodes (AND/OR/XOR/NAND/NOR/XNOR) with n-ary flattening for same-operator chains (`a&b&c&d` renders as one 4-input AND instead of a cascade), replacing the undifferentiated `comb` blob these expressions previously collapsed into. `(a|b)&c` still renders as OR-feeding-AND — flattening never crosses operator types. NOT already had a dedicated `inverter` glyph and is unchanged. Gate input ports fan out one full grid line apart regardless of input count, growing the gate body to fit instead of falling back to tighter centered spacing for 4+ inputs.
- 24aa5c5: Auto-cut register clock/reset nets and explicitly declared nets when opening a module diagram without a saved layout.
- c787f03: Add grow-only edge/corner resize for `instance` and `register` blocks, with a hover/select-only control to revert to the automatic size.
- 3d5a983: Add a "Cut out" button to the block-selection toolbar that cuts every wire touching the selected block(s), shown from a single selected block onward and merged with "Auto Layout" into one button group when both are visible. Hidden (rather than disabled) once every touching net is already cut, and no longer appears when only a cut net's dangling end is selected.
- 0971ea1: Collapse `[MSB:LSB]` instance arrays into a single stacked instance node instead of emitting N separate nodes with N redundant submodule elaborations. The extractor now detects UHDM's `vpiModuleArray` container, elaborates the submodule once, and stamps the collapsed node with `isArrayNode`/`arrayDimension`/`arraySize`, reusing the existing array-stack rendering. Per-port connections are classified as broadcast vs element-wise per LRM 23.2.
- 35a2762: Add `svsch.minifySvg` config (default on) gating SVGO minification of exported SVGs. Minification runs at export write points (CLI render, extension's exportSvg) — use `--no-minify` in the CLI to opt out.
- 875d245: Render ternary conditional expressions as recursively connected mux nodes in both parser backends.

### Patch Changes

- f76465c: docs: add 8-bit single-cycle CPU example design fixtures, hero preview image, and syntax book reference to README
- 24556c6: chore(deps-dev): bump multiple-cucumber-html-reporter from 4.1.0 to 4.2.0
- 6c0a036: chore(deps-dev): bump @types/node from 26.1.0 to 26.2.0
- d8ef746: chore(deps-dev): bump vite from 8.1.3 to 8.2.0
- 66be5c3: chore(deps): bump actions/cache from 4.3.0 to 6.1.0
- ff3b0b4: chore(deps): bump actions/checkout from 4.4.0 to 7.0.1
- 67dbcf1: chore(deps): bump actions/download-artifact from 4.3.0 to 8.0.1
- 23406c8: chore(deps): bump actions/setup-node from 4.4.0 to 7.0.0
- 07a8ba1: chore(deps): bump actions/upload-artifact from 4.6.2 to 7.0.1
- e636337: chore(deps): bump docker/build-push-action from 5.4.0 to 7.3.0
- 9cf1f31: chore(deps): bump docker/login-action from 3.7.0 to 4.6.0
- c7740b6: chore(deps): bump docker/metadata-action from 5.10.0 to 6.2.0
- 0bd8086: chore(deps): bump docker/setup-buildx-action from 3.12.0 to 4.2.0
- 69b8544: Fix duplicate selection outlines on shaped nodes (scalar mux, select, ALU, and inverter) by removing the redundant rectangular selection element and relying on the node's own SVG shape outline for selection. Array-node selection rectangles are unchanged.
- b3cfd4f: Fix bus composition nodes synthesized from multi-bit unpacked-array elements (e.g. `logic [7:0] arr [3:0]` driven element-by-element and read back as a whole) collapsing each element's width to 1 bit. The composer now uses the array's declared element width instead of treating the `[i]` index as a packed-bus bit slice.
- 438924b: Fix stacked instance-array nodes drawing their left-side (input) port leads on top of the node body, obscuring the `u_child[0]` label, in both the live canvas and exported SVG. CSS z-index doesn't govern paint order for these elements — only raw draw order does — so the front (topmost) card must be the very next element painted after the leads, ahead of the back/middle stack layers, or the leads still bleed through.
- 210e97a: Fix a continuous-assign bug where composing a packed output bus bit-by-bit from array-element reads (e.g. `assign y_bus[i] = y_arr[i];`) dropped the driving edges entirely, leaving the output port unconnected. The alias node representing each bit was deleted before the later pass that stitches those bits into the bus had a chance to consume it.
- fc8f1fb: Fix stacked-instance nodes keeping stale port/edge geometry after a resize drag. React Flow's internal `node.measured` dimension could stay on its pre-resize value when rapid-fire `updateNodeInternals` calls during a multi-step drag raced each other in React Flow's store, most noticeably on slower-to-render stacked/array instance nodes. An extra forced update is now scheduled via `requestAnimationFrame` once the drag's call flurry has drained.
- 46296ff: Fix duplicate address-mux generation when an array has multiple indexed write statements in the same always block. Distinct normal writes now share one array register and chain through address-mux stages, while proven full-range reset loops fold into that register's canonical reset and reset-value ports.
- af774a5: Increase BDD test wait timeouts for the module selector and SVSCH panel tab to reduce CI flakiness under runner resource contention.
- 026c0f1: Fix `captureGraphState()` grabbing the wrong `<path>` for an edge in the visual-regression harness. It selected the first path in the edge's DOM group, which is a jump-halo arc or net-highlight overlay when either is present, instead of the real wire stroke — causing flaky full-route vs tiny-arc JSON diffs with zero PNG diff. Now scoped to `path.svsch-edge`, the class token only the actual stroke paths carry.
- beab4bc: Fix instance-port connections that use a bit-select or literal inline (e.g. `.opcode(instr[7:4])`, `.b(8'd1)`) being silently dropped from the diagram. The instance-port-connection loop now synthesizes the same breakout/literal driver nodes that `processAssign` creates for `assign` statements, so `DesignExtractor::buildEdges`'s exact signal-string matching finds a node to connect to.
- 32c42c0: Fix interface type labels falling back to the browser's serif default instead of the editor font. `.svsch-interface-type-label` had no `font-family`, so it inherited nothing from its SVG ancestors; now set to `var(--vscode-editor-font-family, monospace)` to match the rest of the diagram's text.
- 6a496a7: Fix cut-net-end label highlighting so a marquee-selected block no longer lights up its attached (but unselected) net label's halo/hovered-text. React Flow auto-selects a label's stub edge whenever the block it's attached to is selected; only genuine hover or the label's own `selected` prop now drives the highlight.
- 4a9e119: chore(deps): bump undici, fast-uri, and brace-expansion to clear npm audit high-severity findings
- f151b86: chore(deps): pin transitive js-yaml to patched versions (4.3.1 / 3.15.1) to clear the npm audit high-severity quadratic-CPU finding (GHSA-5p4m-2wfm-xmqj)
- 5c48866: chore(deps): pin transitive js-yaml to patched versions to clear npm audit high-severity finding (CVE-2026-59870)
- 0e247a4: chore(deps-dev): bump nanoid to 3.3.18 (transitive via postcss) to resolve a high-severity `npm audit` advisory (GHSA-2v37-7h3g-55p8) blocking CI
- d9f6a23: Regenerate the syntax-book, visual-regression, and CLI snapshot fixtures that were left stale by the webview CSS split (#157) — they still embedded webview-chrome-only rules (`.shell`, `.busy-indicator`, `.toolbar`, etc.) that no longer belong in exported SVG output since those selectors never match anything in the exported document.
- 6b69676: Fix spurious "No files were found" artifact warning in the test_syntax CI job.
- ef47a73: Fix a race in `extractDesignWithUhdm` where two concurrent calls for the same workspace could spawn Surelog against the same `cacheDir` simultaneously, corrupting one process's partial write and crashing the other's read (`kj::io ... Premature EOF`). Concurrent calls are now serialized per-`cacheDir`: a later caller waits for the earlier one to finish and re-checks the cache before spawning Surelog again.
- c1ddd85: Fix `npm run test:visual` never actually failing on a mismatch. Playwright's `config.updateSnapshots` defaults to `'missing'` unless `--update-snapshots` is passed on the CLI, and the visual-regression helpers treated `'missing'` the same as `'all'`/`'changed'`, unconditionally taking the write-baseline early-return instead of comparing. Dropped `'missing'` from the update-snapshots condition in `test/visual/helper.ts` and `test/visual/elk_geometry.visual.spec.ts`, and regenerated the `loop-node-chromium-linux.json` baseline, which had gone stale since #110's edge-path-selector fix without ever being caught.
- 71a5b32: Anchor the node warning icon to the outline's top-right vertex instead of the bounding box corner, so it no longer floats off shaped nodes (mux, select, ALU, inverter, and skinned port/interface-port nodes).
- a2facc6: Hide the always-visible diagnostics panel and surface warning presence as a status icon in the toolbar instead, mutually exclusive with the busy spinner. The icon shows the warning count inline (e.g. "⚠ 3 warnings"), no per-severity breakdown.
- e1edc28: Add visual regression snapshots (PNG/JSON/SVG) for every module in the example design, so its diagrams are locked in as part of the test suite.
- a76d950: Reduce visual-suite benchmark noise by sampling elaboration and rendering timings median-of-11 instead of once. `buildDesignGraph()` runs up to 11x per fixture build — it repeats filesystem discovery and UHDM extraction each time, so this adds real backend work and may increase CI runtime — and the view is re-opened 11x per test for rendering samples; the screenshot assertion itself still runs once. The system suite is unaffected — its "sample" is a full VS Code boot, not comparable.
- a09f45e: Regenerate snapshot baselines for `docs/syntax-book/assets/mux-*.svg` and `test/visual/__screenshots__/mux.visual.spec.ts-snapshots/*.svg` that went stale from merge skew between #108 and #115, so they pick up #108's `font-family` fix for interface type labels. No source changes.
- 3e6609f: Reject sub-threshold snapshot updates in CI. Visual, BDD, and system Playwright configs now pin `UPDATE_SNAPSHOTS` to compare-first `changed` mode instead of `all`, and `test/steps/fixtures.ts`, `test/steps/diagram.steps.ts`, and the exact comparators in `test/graphRegression.ts` compare before writing a new baseline. A new snapshot gate (`scripts/check-snapshot-updates.ts`) runs on `test_visual`, `test_bdd`, and `test_system` PR jobs and fails the build if a changed baseline's pixel diff falls under its threshold (2 px/120 px for visual overrides, 50 px/100 px for raw pixelmatch), with an allowlist (`test/snapshot-bypass.yml`) for reviewed exceptions.
- 6dcea96: Share and cache project elaboration across diagram panels.
- c0345bc: Split webview styles.css into shared diagram.css and webview-chrome.css so exported SVGs no longer embed unused toolbar/panel CSS, shrinking exported SVGs by ~25-30%.
- 3355265: Tighten the system-test full-window screenshot budget (`maxDiffPixels: 2500` → `500`) and regenerate the stale 1.90.0/1.91.0/1.122.1 baselines. The old budget was high enough that the inline toolbar warning-count label (added in #120) could disappear from a baseline entirely — a 2195px diff — without `--update-snapshots` rewriting it or CI's assertion failing, silently letting a real regression pass.
- e8de93a: Track diagram-generation duration in CI with `github-action-benchmark` so performance regressions are caught automatically. PR runs post one combined comment covering the system/visual suites instead of two separate ones, with a worst/best delta table per suite; visual gets a per-test stacked "elaboration + rendering" bar chart (fastest to slowest), system gets a per-test "baseline vs. this run" bar chart. The visual suite times every test that renders a diagram (previously only fixture-based tests were covered) and reports elaboration (Surelog/UHDM parse) and rendering (webview paint) as separate metrics; the system suite reports one entry per vscode-version instead of only the latest. BDD perf tracking was removed — its timings were dominated by a fixed busy-indicator wait rather than real work (see #167).

## 0.2.2

### Patch Changes

- 2a12b06: Removed VS Code Marketplace and Open VSX publishing from the release workflow. The extension is still packaged and attached to GitHub releases as a `.vsix` file.

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
