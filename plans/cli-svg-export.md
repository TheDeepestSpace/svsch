# Plan: svsch CLI — Headless SVG rendering for CI/documentation

## Context

The extension renders SystemVerilog block diagrams interactively in VS Code. Users want to check clean SVG files into project documentation repos and regenerate them automatically in CI — without running VS Code. The goal is `npx vscode-svsch render src/*.sv --output docs/diagrams/` working in a standard GitHub Actions runner.

**Why pure Node.js SVG serializer (not Puppeteer):**
React Flow renders a hybrid HTML+SVG DOM: module nodes are `<div>` elements, edges are `<svg><path>`. Capturing this with Puppeteer produces SVG-with-`<foreignObject>` wrapping — not renderable in GitHub markdown, GitLab, Notion, or most documentation tools. A pure SVG serializer (`<rect>`, `<text>`, `<path>`) produces self-contained, portable SVG. The geometry for both already exists: `pathFromPoints()` in `src/webview/orthogonal/OrthogonalEdge.tsx`, node sizing in `src/diagram/nodeSizing.ts`, ELK layout in `src/layout/mergeLayout.ts`.

**Key findings from exploration:**
- Parser → IR → ELK layout is already 100% Node.js (no DOM, no vscode)
- SVG path strings are already computed: `pathFromPoints(points)` → `"M x y L x y ..."`
- Build uses Vite; adding a third bundle target for Node.js CLI is straightforward
- The extension already persists layout to `.svsch-layout.json` (via `layoutStore.ts`) — CLI should prefer this

---

## Phase 1: Extract headless core (`src/core/`)

Create a Node.js-safe API surface that wraps the existing pipeline.

**New file: `src/core/index.ts`**
```ts
export async function renderDiagram(
  svFile: string,
  opts: { layoutFile?: string; topModule?: string }
): Promise<DiagramViewModel>
```
This calls the existing `extractDesignWithUhdm()` → `buildViewModel()` chain, with no vscode imports.

**Existing files that are already framework-free (just re-export or thin-wrap):**
- `src/ir/types.ts`, `src/ir/ids.ts`, `src/ir/nodeMetadata.ts`, `src/ir/edgeNet.ts`
- `src/layout/mergeLayout.ts` — no changes needed
- `src/diagram/nodeSizing.ts`, `src/diagram/interfaceGeometry.ts`, `src/diagram/selectLabels.ts`
- `src/parser/uhdmExtractor.ts`, `src/parser/veribleExtractor.ts`, `src/parser/backend.ts`

**Only change needed:** strip `vscode` logger from parser files; inject a `Logger` interface so both VS Code (with OutputChannel) and CLI (with stderr/stdout) can satisfy it. `src/logger.ts` likely already has an abstraction to reuse.

**Extract path utility:**
Move `pathFromPoints()` out of `src/webview/orthogonal/OrthogonalEdge.tsx` into `src/core/pathUtils.ts` so the CLI can import it without pulling in React.

---

## Phase 2: Pure SVG serializer (`src/cli/svgRenderer.ts`)

Takes `DiagramViewModel` → self-contained SVG string with embedded CSS styling.

**CSS preservation strategy:**
`src/webview/styles.css` is 2140 lines but mostly UI chrome (panels, controls). Only ~200 lines apply to diagram elements (node rects, edge paths, ports). The CSS uses:
- VS Code theme CSS variables (e.g. `--vscode-editor-background`) for colors — **set as fixed values in a `:root {}` block** using Dark+ defaults (or via `--theme dark|light` CLI flag)
- `color-mix(in srgb, ...)` for alpha — pre-compute to hex/rgba at build time
- One `<linearGradient>` (bus pipe) — native SVG, copy as-is
- One `<pattern>` (interface stripes) — already SVG, copy as-is
- `stroke-width`, `stroke-linecap`, `stroke-linejoin` — native SVG attributes

**SVG structure:**
```xml
<svg xmlns="..." width="W" height="H" viewBox="0 0 W H">
  <defs>
    <linearGradient id="svsch-bus-gradient" .../>
    <pattern id="svsch-interface-stripes" .../>
  </defs>
  <style>
    /* CSS variable definitions — fixed palette or theme-selected */
    :root { --vscode-editor-background: #1e1e1e; --svsch-node-border: #4a9eff; ... }
    /* Verbatim diagram rules from styles.css (scoped subset, ~200 lines) */
    .svsch-node { fill: var(--vscode-editor-background); stroke: var(--svsch-node-border); }
    .svsch-edge { stroke: var(--svsch-edge-color); fill: none; stroke-width: 1.5px; }
    ...
  </style>
  <g class="nodes">
    <rect class="svsch-node" x y width height/>     <!-- same class names as webview -->
    <text class="svsch-label" x y>ModuleName</text>
    <rect class="svsch-port" .../>
  </g>
  <g class="edges">
    <path class="svsch-edge" d="M x y L x y..."/>   <!-- pathFromPoints() reused -->
    <text class="svsch-net-label" x y>net_name</text>
  </g>
</svg>
```

**Styling is preserved because:** SVG `<style>` blocks are supported by GitHub, GitLab, Inkscape, and all browsers. The same class names from the webview are used on the SVG elements. The only difference is VS Code's live theme injection is replaced by fixed color values — CLI defaults to Dark+ but `--theme light` is supported.

**New file: `src/cli/theme.ts`** — maps VS Code CSS variable names to hex values for dark/light themes.

**Reuse from existing code:**
- `pathFromPoints()` (after moving to `src/core/pathUtils.ts`) for edge `d` attribute
- `src/diagram/nodeSizing.ts` for node/port dimensions
- `src/diagram/interfaceGeometry.ts` for port positions
- Diagram CSS rules extracted from `src/webview/styles.css` (verbatim copy of the diagram-relevant subset)

---

## Phase 3: CLI entry point (`src/cli/index.ts`)

**Commands:**
```
svsch render <file.sv> [--output <path>] [--top <module>] [--layout <json>] [--no-layout] [--watch]
svsch render <glob>    [--output-dir <dir>]
```

**Defaults:**
- `--output`: `<file>.svg` next to the `.sv` file
- `--layout`: `<file>.svsch-layout.json` (created by the extension) — prefer this, auto-layout new nodes only
- `--no-layout`: ignore saved layout, run full ELK auto-layout

**Arg parsing:** use Node.js `parseArgs` (built-in, no extra dep) or `minimist` (already in dep tree to check).

---

## Phase 4: Build — Vite CLI bundle

**New file: `vite.config.cli.ts`**
```ts
export default defineConfig({
  build: {
    target: 'node18',
    lib: { entry: 'src/cli/index.ts', formats: ['cjs'], fileName: 'cli' },
    outDir: 'dist',
    rollupOptions: { external: ['vscode'] }
  }
})
```

**`package.json` changes:**
```json
"bin": { "svsch": "./dist/cli.js" },
"scripts": {
  "build:cli": "vite build --config vite.config.cli.ts",
  "build": "npm run build:ext && npm run build:webview && npm run build:cli"
},
"files": ["dist/", "media/", "out/"]
```

**`.vscodeignore` addition:**
```
dist/cli.js
```
Keeps `.vsix` size down — extension users don't need the CLI binary.

---

## Phase 5: Distribution

### npm (primary)
```bash
npm publish   # dist/cli.js included via "files" field
```
CI usage:
```yaml
- run: npx vscode-svsch@latest render 'src/**/*.sv' --output-dir docs/diagrams/
```

### Standalone binary (optional, later)
Use `@vercel/ncc` + `pkg` to compile to native binary. Automate via GitHub Actions release workflow:
```yaml
on: { push: { tags: ['v*'] } }
jobs:
  release:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - run: npx pkg dist/cli.js --targets node18-linux-x64,node18-macos-arm64,node18-win-x64
      - uses: softprops/action-gh-release@v2
        with: { files: svsch-* }
```
Binary names: `svsch-linux-x64`, `svsch-macos-arm64`, `svsch-win-x64`.

### VS Code extension (.vsix)
Unchanged — `vsce package` produces `.vsix` from `dist/extension.js` + `media/webview.js`.

---

## Phase 6: CI integration example

```yaml
# .github/workflows/docs.yml
name: Render diagrams
on: [push]
jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx vscode-svsch@latest render 'src/**/*.sv' --output-dir docs/diagrams/
      - uses: peter-evans/create-pull-request@v6
        with:
          commit-message: 'docs: update diagrams'
          branch: update-diagrams
```

---

## Verification

1. `npm run build:cli` produces `dist/cli.js`
2. `node dist/cli.js render tests/fixtures/counter.sv -o /tmp/counter.svg` exits 0 and writes valid SVG
3. Open `/tmp/counter.svg` in a browser — matches what the VS Code extension renders
4. `cat /tmp/counter.svg` contains no `<foreignObject>` — pure SVG elements only
5. SVG renders correctly in a GitHub markdown `![](docs/diagrams/counter.svg)` reference
6. `npx . render tests/fixtures/counter.sv` works from the project root (tests the npm bin field)
7. Extension `.vsix` built with `vsce package` does not include `dist/cli.js` (check `.vscodeignore`)
