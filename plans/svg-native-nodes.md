# Plan: SVG-Native Node Rendering

## Motivation

The current CLI SVG export re-implements the diagram's visual logic in a separate
serializer (`src/cli/svgRenderer.ts`). This creates two sources of truth: the React
components in `main.tsx` (used in the VS Code webview) and the serializer (used by
the CLI). Every time a visual element changes in the webview, the serializer must be
updated separately, and it is already missing several elements (clock glyph, bus pipe,
bus tap lines, array dimension badge, MUX select lead).

The root cause is that the React node components are written using HTML primitives
(`<div>`, CSS `box-shadow`, `display: flex`), which require a browser's layout engine
to produce geometry. Without that, the CLI cannot reuse them.

**The goal of this plan** is to rewrite the node components using SVG primitives
(`<rect>`, `<text>`, `<path>`, `<g>`) so that:

1. The webview continues to work exactly as today (React Flow renders the SVG
   components inside its HTML layer)
2. The CLI can call `React.renderToStaticMarkup(<NodeSvg …/>)` in plain Node.js —
   no browser, no Playwright, no separate serializer

---

## Architecture Overview

### Current

```
main.tsx  (1800 lines, HTML nodes)
  └── HdlNode → renders HTML divs + CSS layout
                 React Flow positions them on the canvas

src/cli/svgRenderer.ts
  └── Re-implements all visual logic from scratch in SVG
      (incomplete — missing clock glyph, bus pipe/taps, array badge, etc.)
```

### Target

```
src/webview/nodes/
  <Kind>NodeSvg.tsx    ← pure SVG React component, no DOM dependency
  <Kind>Node.tsx       ← thin React Flow wrapper: handles + interactive decoration
  index.ts             ← re-exports nodeTypes map for React Flow

src/diagram/
  registerGeometry.ts  ← registerPortTop(), registerExtraInputPortTop()
  busGeometry.ts       ← busTapPortCenterY(), busPipeGeometry()
  muxGeometry.ts       ← muxInputPortCenterY(), muxTopPortLeadLengthY(), …

src/cli/svgRenderer.ts
  └── Iterates DiagramViewModel nodes
      Calls renderToStaticMarkup(<NodeSvg …/>) per node
      Combines with edge SVG already being produced
      Outputs complete self-contained SVG file
```

The SVG components are the **single source of truth** for all diagram visuals. The
webview wraps them in HTML for React Flow interaction. The CLI renders them headlessly
in Node.js.

---

## Constraints

- **No change to existing webview functionality** — interactions, dragging, edge
  routing, layout persistence, cut nets, net labels all stay exactly as today.
- **No change to the extension host** — `DiagramViewModel`, ELK layout, parser
  backends are untouched.
- **No change to CSS for edges** — `styles.css` edge rules (`.svsch-edge`,
  `.svsch-edge-struct`, etc.) already use SVG CSS properties and continue working
  unchanged.
- **React Flow handles stay HTML** — React Flow connection handles must remain HTML
  elements. The refactor moves the *visual content* to SVG; handles are overlaid as
  HTML siblings.

---

## Key Technical Decisions

### 1. Where SVG nodes live inside React Flow

React Flow renders each registered node type as an absolutely-positioned HTML `<div>`.
That div can contain anything, including an `<svg>`. The wrapper component returns:

```tsx
// RegisterNode.tsx (thin wrapper registered with React Flow)
export function RegisterNode({ data }: NodeProps<HdlFlowNode>) {
  const { node } = data;
  const { width, height } = diagramNodeDimensions(node);
  return (
    <>
      {/* Visual — pure SVG, also used by CLI */}
      <RegisterNodeSvg node={node} width={width} height={height} selected={selected} />

      {/* Handles — HTML, required by React Flow */}
      <RegisterNodeHandles node={node} width={width} height={height} />

      {/* Selection ring, array cosmetic layers — HTML, interactive only */}
      {isArray && <ArrayStackLayers kind="register" width={width} height={height} />}
      <NodeSelectionRect isArray={isArray} width={width} height={height} />
    </>
  );
}
```

`RegisterNodeSvg` is a pure function of `(node, width, height, selected?)` with zero
DOM or browser dependencies. React Flow sees an `<svg>` child and renders it fine.

### 2. Handle positioning

Currently handles are positioned with CSS variables (`--svsch-register-clock-top`).
After the refactor they are positioned with explicit numbers from the shared geometry
functions:

```tsx
// RegisterNodeHandles.tsx
function RegisterNodeHandles({ node, width, height }) {
  const dTop    = registerPortTop('d',     height, hasReset, hasRv);
  const qTop    = registerPortTop('q',     height, hasReset, hasRv);
  const clkTop  = registerPortTop('clock', height, hasReset, hasRv);
  const rstTop  = registerPortTop('reset', height, hasReset, hasRv);
  return (
    <>
      <Handle type="target" position={Position.Left}
              style={{ left: 0, top: dTop + g/2 }} />
      <Handle type="source" position={Position.Right}
              style={{ right: 0, top: qTop + g/2 }} />
      <Handle type="target" position={Position.Left}
              style={{ left: 0, top: clkTop + g/2 }} />
      {hasReset && <Handle type="target" position={Position.Bottom}
              style={{ bottom: 0, left: width/2, top: rstTop + g }} />}
    </>
  );
}
```

The geometry functions are imported from the shared `src/diagram/` files — the same
import that the SVG renderer uses.

### 3. CSS strategy

The SVG components use CSS class names (`.svsch-node-shape`, `.svsch-node-title`,
`.hdl-node-register`, etc.) for styling, exactly as today. `styles.css` is already
shipped in the webview bundle. For the CLI SVG output, `styles.css` is included
verbatim in the `<style>` block (already implemented). The thin CSS bridge
(`svgBridgeCss`) covers only the one remaining gap: `box-shadow: inset` on HTML
divs has no SVG equivalent; the bridge maps per-node-kind class names to SVG
`stroke` on the shape element.

### 4. `renderToStaticMarkup` in the CLI

`react-dom/server` works in Node.js without any DOM. The CLI Vite bundle already
pulls in React (it's a dependency). The renderer loop becomes:

```typescript
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeSvg } from '../webview/nodes';

function renderNode(node: PositionedNode): string {
  const { width, height } = diagramNodeDimensions(node);
  const svgContent = renderToStaticMarkup(
    <NodeSvg node={node} width={width} height={height} />
  );
  return `<g class="svsch-node ${nodeClasses(node)}"
             data-node-id="${escapeAttr(node.id)}"
             transform="translate(${node.position.x} ${node.position.y})">
    ${svgContent}
  </g>`;
}
```

`NodeSvg` is a dispatcher that delegates to the correct kind-specific component.
Edges continue to be rendered as today (they already use pure SVG geometry).

---

## File Structure

```
src/
  diagram/
    constants.ts                  (unchanged)
    nodeSizing.ts                 (unchanged)
    interfaceGeometry.ts          (unchanged)
    registerGeometry.ts           ← NEW (extracted from main.tsx)
    busGeometry.ts                ← NEW (extracted from main.tsx)
    muxGeometry.ts                ← NEW (extracted from main.tsx)

  webview/
    main.tsx                      ← shrinks significantly; HdlNode imports from nodes/
    nodes/
      index.ts                    ← nodeTypes map for React Flow + NodeSvg dispatcher
      shared/
        NodeSelectionRect.tsx     ← moved from main.tsx
        ArrayStackLayers.tsx      ← moved from main.tsx (HTML cosmetic layers)
        ArrayStackLeads.tsx       ← moved from main.tsx (SVG leads)
        TypeLabel.tsx             ← moved from main.tsx
        PortLabel.tsx             ← moved from main.tsx
        PortTypeSuffix.tsx        ← moved from main.tsx
      port/
        PortNodeSvg.tsx           ← SVG visual (input/output/harness skins)
        PortNode.tsx              ← React Flow wrapper + handles
      register/
        RegisterNodeSvg.tsx       ← SVG visual (rect, labels, clock glyph)
        RegisterNode.tsx          ← React Flow wrapper + handles
      instance/
        InstanceNodeSvg.tsx       ← SVG visual
        InstanceNode.tsx          ← React Flow wrapper + handles
      bus/
        BusNodeSvg.tsx            ← SVG visual (pipe + taps + labels)
        BusNode.tsx               ← React Flow wrapper + handles
      mux/
        MuxNodeSvg.tsx            ← SVG visual (trapezoid + select lead + port labels)
        MuxNode.tsx               ← React Flow wrapper + handles
      alu/
        AluNodeSvg.tsx
        AluNode.tsx
      inverter/
        InverterNodeSvg.tsx
        InverterNode.tsx
      comb/
        CombNodeSvg.tsx
        CombNode.tsx
      literal/
        LiteralNodeSvg.tsx
        LiteralNode.tsx
      netLabel/
        NetLabelNodeSvg.tsx
        NetLabelNode.tsx
      interface/
        InterfaceNodeSvg.tsx
        InterfaceNode.tsx
      latch/
        LatchNodeSvg.tsx          ← same as register, different CSS class
        LatchNode.tsx

  cli/
    svgRenderer.ts                ← simplified: calls renderToStaticMarkup(NodeSvg)
    index.ts                      ← unchanged
    theme.ts                      ← unchanged
```

---

## Implementation Phases

### Phase 0 — Extract shared geometry (no visible change, ~1 hour)

Create the three geometry files. Each is a direct extraction of existing private
functions from `main.tsx` — zero logic changes.

**`src/diagram/registerGeometry.ts`**
```typescript
import { diagramSizing } from './constants';

export function registerPortTop(
  role: 'd' | 'q' | 'clock' | 'reset' | 'rv',
  nodeHeight: number,
  _hasReset: boolean,
  hasRv: boolean
): number {
  const g = diagramSizing.gridSize;
  if (role === 'd' || role === 'q')  return diagramSizing.nodeHeaderHeight;
  if (role === 'clock')              return diagramSizing.nodeHeaderHeight + g;
  if (role === 'rv')                 return diagramSizing.nodeHeaderHeight + g * 2;
  return nodeHeight - g;  // reset
}

export function registerExtraInputPortTop(
  index: number,
  nodeHeight: number,
  hasRv: boolean
): number {
  const g = diagramSizing.gridSize;
  const offset = hasRv ? 3 : 2;
  return Math.min(diagramSizing.nodeHeaderHeight + g * (index + offset), nodeHeight - g);
}
```

**`src/diagram/busGeometry.ts`**
```typescript
import { diagramSizing } from './constants';

/** Y-centre of tap row `index` within a bus/struct/interface node. */
export function busTapPortCenterY(index: number, startUnits = 1): number {
  return diagramSizing.gridSize * (index * 2 + startUnits);
}

/**
 * X position (left edge) of the bus pipe rect.
 * `width` is the full node width. `isComposition` is true when the single
 * aggregate port is on the right (bus composition) vs left (bus breakout).
 * `isArray` shifts the pipe slightly to leave room for the stack lead.
 */
export function busPipeX(
  width: number,
  isComposition: boolean,
  isArray: boolean
): number {
  const g = diagramSizing.gridSize;
  if (isComposition) return isArray ? width - g * 2.5 + 3 - 6 : width - g * 2 - 6;
  return isArray ? g * 1.5 - 3 : g * 2;
}
```

**`src/diagram/muxGeometry.ts`**
```typescript
import { diagramSizing } from './constants';

/** Y-centre of side input port `index` inside a MUX/select trapezoid. */
export function muxInputPortCenterY(
  index: number,
  count: number,
  height: number
): number {
  const g = diagramSizing.gridSize;
  const heightUnits = Math.max(1, Math.round(height / g));
  const startUnit   = Math.max(1, Math.ceil((heightUnits - count + 1) / 2));
  return g * (startUnit + index);
}

/** Y where the trapezoid edge sits for top-port `index`. */
export function muxTopPortSkinEdgeY(
  index: number,
  count: number,
  height: number
): number {
  const xFrac = (index + 1) / (count + 1);
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  return ((height - rightSideHeight) / 2) * xFrac;
}

/** Length of the vertical drop-line drawn above a wide top-port. */
export function muxTopPortLeadLengthY(
  index: number,
  count: number,
  height: number
): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize);
}
```

Update `main.tsx` to import these and remove the local definitions (replace ~24 lines
with 3 import lines, no logic change). Verify the webview still compiles and renders
identically.

---

### Phase 1 — Split `main.tsx` into per-node files (~3–4 hours)

`main.tsx` at ~1 800 lines is hard to work in. Before writing SVG components, split
it mechanically:

1. Move small shared helpers to `src/webview/nodes/shared/`:
   - `TypeLabel`, `PortLabel`, `PortTypeSuffix`, `ParameterToken`, `ParameterizedText`
   - `NodeSelectionRect`, `ArrayStackLayers`, `ArrayStackLeads`, `NetLabelWire`
   - `RegisterClockGlyph`, `formatNodeKind`

2. Move the skin SVG helpers used only in render (`PortSkin`, `MuxSkin`, `SelectSkin`,
   `AluSkin`, `InverterSkin`, `InterfaceSkin`) to `src/webview/nodes/shared/skins.tsx`.

3. Create stub files for each node kind (just re-export the existing `HdlNode` for
   now — the existing behavior is unchanged). The goal is to establish the file
   structure before any visual logic changes.

This phase ends with `main.tsx` < 400 lines, all tests green, webview unchanged.

---

### Phase 2 — Write SVG node components (the core work, ~2–3 days)

For each node kind, create `<Kind>NodeSvg.tsx`. These components:

- Accept `(node: DiagramNode, width: number, height: number, selected?: boolean)` as
  props
- Return pure SVG elements rooted at a `<g>` (no wrapping `<svg>` — the `renderNode`
  loop in the CLI adds the `<g>` with the transform)
- Use CSS class names from `styles.css` for colors and strokes
- Use geometry functions from `src/diagram/` for positions

#### RegisterNodeSvg

```tsx
export function RegisterNodeSvg({ node, width, height }: NodeSvgProps) {
  const hasReset = Boolean(registerResetSignal(node));
  const hasRv    = node.ports.some(p => p.name === 'rv' || p.name === 'RV');
  const g        = diagramSizing.gridSize;
  const dTop     = registerPortTop('d',     height, hasReset, hasRv);
  const qTop     = registerPortTop('q',     height, hasReset, hasRv);
  const clkTop   = registerPortTop('clock', height, hasReset, hasRv);

  return (
    <>
      {/* Body */}
      <rect className="svsch-node-shape" width={width} height={height} rx={5} />
      {/* Kind + title */}
      <text className="svsch-node-kind"  x={width/2} y={10}        textAnchor="middle">
        REGISTER
      </text>
      <text className="svsch-node-title" x={width/2} y={diagramSizing.nodeHeaderHeight/2}
            textAnchor="middle">
        {nodeTitle(node)}
      </text>
      {/* D port label */}
      <text className="svsch-port-label" x={12} y={dTop + g/2}>
        {dPortLabel(node)}
      </text>
      {/* Q port label */}
      <text className="svsch-port-label" x={width - 12} y={qTop + g/2}
            textAnchor="end">
        {qPortLabel(node)}
      </text>
      {/* Clock glyph */}
      <svg x={2} y={clkTop + g/2 - 6} width={12} height={12} viewBox="0 0 12 12"
           className="register-clock-glyph" aria-hidden="true">
        <path d="M 1 1.5 L 9 6 L 1 10.5"/>
      </svg>
      {/* Reset label (if present) */}
      {hasReset && <ResetLabel node={node} width={width} height={height} />}
      {/* Array badge */}
      <ArrayBadge node={node} width={width} />
    </>
  );
}
```

**Important**: the `<svg>` wrapper around the clock glyph uses SVG-inside-SVG, which
is valid and already works in all browsers and SVG viewers.

#### BusNodeSvg

```tsx
export function BusNodeSvg({ node, width, height }: NodeSvgProps) {
  const isComposition = isBusComposition(node);   // see §Bus composition detection
  const isArray       = nodeIsArrayNode(node);
  const taps          = busTaps(node, isComposition);
  const tapCenters    = taps.map((_, i) => busTapPortCenterY(i, 1));
  const pipeX         = busPipeX(width, isComposition, isArray);
  const pipeY         = tapCenters[0]  - diagramSizing.gridSize / 2;
  const pipeH         = tapCenters.at(-1)! - tapCenters[0] + diagramSizing.gridSize;

  return (
    <>
      <rect className="svsch-node-shape" width={width} height={height} rx={0} />
      {/* Pipe */}
      <rect className="svsch-bus-pipe" x={pipeX} y={pipeY} width={6} height={pipeH} rx={3}/>
      {/* Taps */}
      {taps.map((port, i) => {
        const cy    = tapCenters[i];
        const label = port.label ?? port.name;
        return isComposition ? (
          <g key={port.id}>
            <line className="svsch-bus-tap-line" x1={3}       y1={cy} x2={pipeX}   y2={cy}/>
            <text className="svsch-bus-tap-label" x={pipeX-6} y={cy} textAnchor="end">
              {label}
            </text>
          </g>
        ) : (
          <g key={port.id}>
            <line className="svsch-bus-tap-line" x1={pipeX+6}  y1={cy} x2={width-3} y2={cy}/>
            <text className="svsch-bus-tap-label" x={pipeX+12} y={cy}>
              {label}
            </text>
          </g>
        );
      })}
      <ArrayBadge node={node} width={width} />
    </>
  );
}
```

#### MuxNodeSvg / SelectNodeSvg

```tsx
export function MuxNodeSvg({ node, width, height }: NodeSvgProps) {
  const topPorts  = muxTopPorts(node);
  const sidePorts = muxSidePorts(node);

  return (
    <>
      {/* Trapezoid shape */}
      <path className="svsch-node-shape" d={muxPath(width, height, false)}/>
      {/* Select lead + top-port label */}
      {topPorts.map((port, i) => {
        const leadLen = muxTopPortLeadLengthY(i, topPorts.length, height);
        const portX   = muxTopPortX(i, topPorts.length, width);
        return (
          <g key={port.id}>
            {leadLen > 0 && (
              <line className="svsch-mux-select-lead"
                    x1={portX} y1={0} x2={portX} y2={leadLen}/>
            )}
            <text className="svsch-port-label"
                  x={portX} y={muxTopPortSkinEdgeY(i, topPorts.length, height) + 12}
                  textAnchor="middle">
              {port.label ?? port.name}
            </text>
          </g>
        );
      })}
      {/* Side input labels */}
      {sidePorts.map((port, i) => (
        <text key={port.id} className="svsch-port-label"
              x={12} y={muxInputPortCenterY(i, sidePorts.length, height)}
              dominantBaseline="middle">
          {port.label ?? port.name}
        </text>
      ))}
      {/* Output label */}
      <text className="svsch-port-label"
            x={width - 12} y={height / 2}
            textAnchor="end" dominantBaseline="middle">
        {muxOutputPort(node)?.label}
      </text>
      <ArrayBadge node={node} width={width} />
    </>
  );
}
```

#### Shared small components

**`ArrayBadge`** — rendered for every `isArray` node:
```tsx
function ArrayBadge({ node, width }: { node: DiagramNode; width: number }) {
  const dim = nodeArrayDimension(node);
  if (!dim) return null;
  return (
    <text className="svsch-node-kind svsch-array-badge"
          x={width + 3} y={-8} textAnchor="start">
      {dim}
    </text>
  );
}
```

**`PortNodeSvg`** — the `src/diagram/portSkinPath()` function already produces the
correct path. The component just wraps it:
```tsx
export function PortNodeSvg({ node, width, height }: NodeSvgProps) {
  const port      = node.ports[0];
  const direction = portDirection(node);          // 'input' | 'output' | 'harness'
  const d         = portSkinPath(direction, width, height, ...);
  return (
    <>
      <path className={`svsch-node-shape svsch-port-skin svsch-port-skin-${direction}`}
            d={d}/>
      <text className="svsch-node-title" x={width/2} y={height/2}
            textAnchor="middle" dominantBaseline="middle">
        {portNodeTitle(node)}
      </text>
      <ArrayBadge node={node} width={width} />
    </>
  );
}
```

#### Other node kinds

| Kind | SVG shape | Notes |
|------|-----------|-------|
| `instance` | `<rect>` + kind + title + port labels + parameter chips | Parameter chips become `<text>` rows inside the rect |
| `comb` / `loop` | `<rect>` + kind text + port labels | Straight port-label rendering |
| `alu` | `aluPath()` (already in svgRenderer) + operation symbol | |
| `inverter` | Triangle + bubble (already in svgRenderer) | |
| `literal` / `replicate` | Simple `<rect>` + `<text>` | |
| `interface` (instance) | `interfaceSkinPath()` (already in svgRenderer) + tap labels | |
| `interface` (port) | Port skin via `portSkinPath()` | |
| `interface` (modport) | `<rect>` + modport title + side taps | |
| `netLabel` | Horizontal/vertical `<path>` + label pill | Already in svgRenderer, can be moved here |
| `latch` | Same as `register` | Different CSS class only |

---

### Phase 3 — Integrate into webview wrappers (~1 day)

Replace the rendering body of each `HdlNode` kind branch with:

```tsx
// RegisterNode.tsx
export function RegisterNode({ data, selected }: NodeProps<HdlFlowNode>) {
  const { node, arrayConnections } = data;
  const { width, height } = diagramNodeDimensions(node);
  const isArray = nodeIsArrayNode(node);
  return (
    <>
      <RegisterNodeSvg node={node} width={width} height={height} selected={selected} />
      <RegisterNodeHandles node={node} width={width} height={height} />
      {isArray && <ArrayStackLayers kind="register" width={width} height={height} />}
      {isArray && <ArrayStackLeads node={node} arrayConnections={arrayConnections}
                                   width={width} height={height}/>}
      <NodeSelectionRect isArray={isArray} kind="register" width={width} height={height}/>
    </>
  );
}
```

The `HdlNode` monolith in `main.tsx` becomes a thin dispatcher to the per-kind
wrapper, which in turn delegates visuals to the SVG component and handles to the
handles component.

**Verify** the webview looks identical to before by running the full BDD suite.

---

### Phase 4 — Rewrite the CLI SVG renderer (~half a day)

Replace the body of `svgRenderer.ts` with a thin loop:

```typescript
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeSvg } from '../webview/nodes';

export function renderSvg(view: DiagramViewModel, options: SvgRendererOptions = {}): string {
  const theme   = options.theme ?? 'dark';
  const padding = options.padding ?? DEFAULT_PADDING;
  // … compute bounds, width, height, offsetX, offsetY (unchanged) …

  const nodesSvg = view.nodes
    .map((node) => {
      const { width, height } = diagramNodeDimensions(node);
      const classes = nodeClasses(node);   // same logic as before
      const content = renderToStaticMarkup(
        React.createElement(NodeSvg, { node, width, height })
      );
      return `<g class="${classes}" data-node-id="${escapeAttr(node.id)}"
                 transform="translate(${formatNumber(node.position.x + offsetX)} ${formatNumber(node.position.y + offsetY)})">
        ${content}
      </g>`;
    })
    .join('\n');

  const edgesSvg = /* unchanged — edges were already correct SVG geometry */;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" …>`,
    renderDefs(),
    '<style>',
    reactFlowCss,
    extensionCss,
    themeCss(theme),
    svgBridgeCss(),    // only needed for box-shadow → stroke; much smaller now
    '</style>',
    `<g>`,
    edgesSvg,
    nodesSvg,
    '</g>',
    '</svg>',
  ].join('\n');
}
```

The edge-rendering half of `svgRenderer.ts` is unchanged. The node-rendering half
is replaced by `renderToStaticMarkup()` calls. The CSS bridge is reduced to only the
`box-shadow` → stroke mapping (since all fills, strokes, and text colors are now
applied directly by the SVG components via their class names).

---

## Bus Composition Detection

`isComposition` currently lives in `main.tsx`. It is determined by:

```typescript
// A bus node is a "composition" (multiple inputs → single bus output) when it has
// exactly one output port whose width is not 'interface'.
// It is a "breakout" (single bus input → multiple outputs) otherwise.
const aggregateOutputs = node.ports.filter(
  p => p.direction === 'output' && p.width !== 'interface'
);
const isComposition =
  node.kind === 'struct'
  || (node.kind === 'bus' && aggregateOutputs.length === 1);
```

Add `export function isBusComposition(node: DiagramNode): boolean` to
`src/diagram/busGeometry.ts` using this logic so both the webview and CLI can use it.

---

## CSS for New SVG-Only Classes

Add to `svgBridgeCss()` (the SVG-specific override layer):

```css
/* Bus */
.svsch-bus-pipe {
  fill: color-mix(in srgb, var(--vscode-editor-foreground) 72%, transparent);
}
.svsch-bus-tap-line {
  stroke: color-mix(in srgb, var(--vscode-editor-foreground) 72%, transparent);
  stroke-width: 2;
  fill: none;
}
.svsch-bus-tap-label {
  fill: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  dominant-baseline: middle;
}
/* MUX */
.svsch-mux-select-lead {
  stroke: color-mix(in srgb, var(--vscode-editor-foreground) 68%,
                    var(--vscode-editor-background));
  stroke-width: 1.5;
  fill: none;
}
/* Clock glyph — styles.css already has .register-clock-glyph */
/* Array badge */
.svsch-array-badge {
  dominant-baseline: auto;
}
```

---

## Text Handling in SVG vs HTML

HTML features that need explicit SVG equivalents:

| HTML feature | SVG equivalent in components |
|---|---|
| `text-overflow: ellipsis` | Omit — SVG lets text overflow, which is acceptable for documentation export. For the webview, the HTML wrapper can add `overflow: hidden` on the outer div while the SVG text flows naturally |
| `overflow: hidden` | Same as above — HTML wrapper clips, SVG export shows full text |
| `display: flex; justify-content: space-between` | Compute left/right positions explicitly from `width` |
| `line-height` | Use `y` attribute spacing based on `diagramSizing.gridSize` |
| `dominant-baseline: middle` | Add to all `<text>` that need vertical centering |

Text overflow is the only real quality gap compared to the webview. For node titles
and port labels in typical designs the strings are short enough that this rarely
matters. A future improvement can add SVG `clip-path` for strict truncation.

---

## `react-dom/server` in the CLI Bundle

`react-dom` is already a production dependency. `react-dom/server` is part of it.
No new dependencies are needed.

Update `vite.config.cli.ts` to NOT externalize `react` and `react-dom` (they're
already bundled since they're in `dependencies`, not `devDependencies`):

```typescript
external: (id) =>
  nodeBuiltins.has(id)
  || id === 'vscode'
  || id.startsWith('@playwright')
  || id === 'playwright'
  // react and react-dom are intentionally NOT external — they get bundled
```

The resulting `dist/cli.js` will be larger (~500 KB gzip vs ~170 KB today) because
React is now included. This is acceptable for a CLI tool.

---

## Testing Strategy

### Phase 0 & 1 — No regression
- Run `npm run test:bdd` after each phase; all scenarios must pass
- Run `npm run lint` to verify TypeScript compiles

### Phase 2 — Visual diff
- After each new `*NodeSvg` component, run a headless render (using the existing
  Playwright infrastructure) to produce a side-by-side PNG comparison:
  the current webview screenshot vs. the SVG rendered by `renderToStaticMarkup`
- The BDD snapshot `--03--cli-png.png` becomes `--03--cli-svg.svg`; snapshot
  comparison catches regressions

### Phase 3 — No regression
- Full BDD suite must remain green
- Manual visual inspection of the webview for each node kind

### Phase 4 — CLI output validation
- `npm run build:cli && node dist/cli.js render tests/fixtures/counter.sv -o /tmp/test.svg`
- Open in browser and compare against VS Code webview screenshot
- Validate: `python3 -c "import xml.etree.ElementTree as ET; ET.parse('/tmp/test.svg'); print('valid')"` 
- Verify no `<foreignObject>` in output

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| SVG `<text>` renders at slightly different pixel positions than HTML text | High | Acceptable for documentation export; use `dominant-baseline` and exact Y values from geometry functions |
| `text-overflow: ellipsis` breaks for long labels | Low (most labels are short) | Webview clips via HTML overflow; SVG shows full text |
| React Flow handle positions drift from SVG port positions | Medium | Handles use the same `registerPortTop()` / `busTapPortCenterY()` etc. as the SVG components — they're guaranteed to agree |
| `renderToStaticMarkup` output differs from browser rendering | Low | The components are pure functions; `renderToStaticMarkup` and browser rendering produce identical HTML (minus interactive event handlers) |
| Bundle size increase | Certain (~330 KB gzip increase) | React is a small fraction of a documentation-purpose CLI binary; acceptable |
| Array cosmetic layers (back/middle/front divs) still HTML | Expected | These are interactive-only decoration. The SVG export shows the array shadow paths already produced by `renderArrayShadow()` in `svgRenderer.ts`, which stays |

---

## Success Criteria

1. `npm run test:bdd` — all 43+ scenarios pass
2. `npm run build:cli` — `dist/cli.js` builds without errors
3. `node dist/cli.js render src/fixtures/counter.sv -o /tmp/counter.svg` — exits 0
4. `/tmp/counter.svg` opens in a browser and looks identical to the VS Code webview
5. `/tmp/counter.svg` contains no `<foreignObject>`
6. `/tmp/counter.svg` is valid XML
7. A new `counter.svg` in a GitHub markdown `![]()` reference renders correctly
8. No new imports of `window`, `document`, or browser globals in `*NodeSvg.tsx` files
