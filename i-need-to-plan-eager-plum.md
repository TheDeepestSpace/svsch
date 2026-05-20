# Plan: SystemVerilog Array Visualization — First Pass

## Context

The tool currently has no concept of SystemVerilog unpacked arrays. Constructs like `reg [31:0] M[0:SIZE-1]` and `input wire [31:0] words[4:0]` are either silently dropped or treated as plain scalars. Arrays are pervasive in real designs: memories, register files, FIFOs, and parameterized pipelines all use them. The first pass establishes the full stack needed to detect arrays, render them as isometric stacked blocks, and model array-write operations (`M[address] <= data`) as a demux node feeding a stacked register.

**What's in scope for first pass:**
- C++ backend: extract unpacked array dimensions for register variables; detect variable-index write → emit demux node
- TypeScript IR: add `arrayDimension`, `isArrayNode` fields; add `demux` node kind
- Rendering: isometric 3-layer stacking on array-tagged nodes (see visual spec below); `[N]` badge in corner
- Demux node: IR definition, sizing, ELK port layout, JSX renderer, CSS styling

**Explicitly deferred to pass 2:**
- Variable-index array reads (`out = M[addr]` → mux-from-array stack)
- Feedback mux stacks for array registers (hold behavior)
- Array-typed port nodes (stacked module input/output ports)
- Constant-index element access highlighting (`M[3]` as a specific slot)
- Multi-dimensional arrays
- Array edge multiplicity rendering (stacked wires)
- Dedicated DemuxSkin SVG (first pass reuses MuxSkin)

---

## Layer 1 — C++ Backend

### Files to modify
- `src/parser/backend_cpp/include/extractor.hpp`
- `src/parser/backend_cpp/src/extractor_parts/modules.inc`
- `src/parser/backend_cpp/src/extractor_parts/procedural.inc`
- `src/parser/backend_cpp/src/extractor_parts/serialization.inc`

### 1a. Extend structs (`extractor.hpp`)

**`Module` struct** (line 176): add two maps that are populated during variable scanning and consumed by process extraction:
```cpp
std::map<std::string, std::string> arrayDimensions;  // base signal → "[0:31]"
std::map<std::string, int> arraySizes;               // base signal → 32
```

**`Node::metadata` anonymous struct** (line 131): add after `bool packed`:
```cpp
bool isArrayNode = false;
std::string arrayDimension;      // "[0:31]" or "[0:SIZE-1]"
int arraySize = 0;               // 0 = parametric
std::string arrayIndexSignal;    // non-empty = variable-index write → demux
```

### 1b. Populate array maps during variable scan (`modules.inc`, lines 69–80)

Inside the `for (int var_type : {vpiNet, vpiReg, vpiVariables, ...})` loop, after inserting to `internalSignals`, add a second range check:
```cpp
// Check for unpacked (array) dimension: UHDM places it as the 2nd range
vpiHandle range_itr = vpi_iterate(vpiRange, var_handle);
if (range_itr) {
    vpi_scan(range_itr);  // skip packed range (already captured in width)
    vpiHandle unpacked = vpi_scan(range_itr);
    if (unpacked) {
        int lft = vpi_get(vpiLeftRange, unpacked);
        int rgt = vpi_get(vpiRightRange, unpacked);
        if (lft != vpiUndefined && rgt != vpiUndefined) {
            std::string dim = "[" + std::to_string(lft) + ":" + std::to_string(rgt) + "]";
            mod.arrayDimensions[name] = dim;
            mod.arraySizes[name] = std::abs(lft - rgt) + 1;
        }
    }
    vpi_release_handle(range_itr);
}
```

### 1c. Tag register nodes and emit demux for variable-index writes (`procedural.inc`)

In `processAlwaysFf()`, for each `reg_name` in `reg_assigns` (around line 277), after extracting `reg_base`:

```cpp
bool is_array_reg = mod.arrayDimensions.count(reg_base) > 0;

// Check if reg_name has a variable index (non-numeric content between [ ])
bool is_variable_index = false;
std::string index_expr;
if (is_array_reg) {
    size_t bracket = reg_name.find('[');
    if (bracket != std::string::npos) {
        index_expr = reg_name.substr(bracket + 1);
        if (!index_expr.empty() && index_expr.back() == ']') index_expr.pop_back();
        bool is_numeric = !index_expr.empty() && std::all_of(index_expr.begin(), index_expr.end(), ::isdigit);
        is_variable_index = !is_numeric;
    }
}
```

**If `is_variable_index`**: emit a `demux` node instead of a register. The demux represents "write_data fanned out to array element selected by address":
```cpp
if (is_variable_index) {
    Node demux;
    demux.id = "demux:" + mod.name + ":" + reg_base + ":" + index_expr;
    demux.kind = "demux";
    demux.label = reg_base;
    demux.source = n.source;  // reuse the register source
    demux.metadata.arrayDimension = mod.arrayDimensions[reg_base];
    demux.metadata.arraySize = mod.arraySizes[reg_base];
    demux.metadata.arrayIndexSignal = index_expr;
    // Ports:
    demux.ports.push_back({"in", "input", d_signal, d_width, "in"});
    demux.ports.push_back({"sel", "input", index_expr, ""});
    demux.ports.push_back({"out", "output", reg_base, mod.arrayDimensions[reg_base]});
    if (!clk_signal.empty()) demux.ports.push_back({clk_signal, "input", clk_signal, ""});
    mod.nodes.push_back(demux);
    continue;  // skip the register node creation below
}
```

**If `is_array_reg` and NOT variable index**: it's a whole-array or constant-index register. Set:
```cpp
n.metadata.isArrayNode = true;
n.metadata.arrayDimension = mod.arrayDimensions[reg_base];
n.metadata.arraySize = mod.arraySizes[reg_base];
```

**Ensure the array register node itself exists once**: when a demux is created for `M[addr]`, also ensure a register node for the whole `M` array exists (check `mod.nodes` for an existing `"reg:<module>:M"` node before pushing).

### 1d. Serialize new fields (`serialization.inc`, after line 199)

In the node serialization loop, after existing metadata fields are written, add:
```cpp
if (n.metadata.isArrayNode) j_meta["isArrayNode"] = true;
if (!n.metadata.arrayDimension.empty()) j_meta["arrayDimension"] = n.metadata.arrayDimension;
if (n.metadata.arraySize > 0) j_meta["arraySize"] = n.metadata.arraySize;
if (!n.metadata.arrayIndexSignal.empty()) j_meta["arrayIndexSignal"] = n.metadata.arrayIndexSignal;
```

After C++ changes, rebuild:
```
cd src/parser/backend_cpp/build && cmake --build .
cp src/parser/backend_cpp/build/svsch_backend dist/svsch_backend
```

---

## Layer 2 — TypeScript IR

### File: `src/ir/types.ts`

**`DiagramNodeKind`** (line 1): add `'demux'`

**`DiagramNodeMetadata`** (lines 63–88): add after `packed?`:
```typescript
isArrayNode?: boolean;
arrayDimension?: string;   // "[0:31]"
arraySize?: number;        // absent = parametric
arrayIndexSignal?: string; // demux: the index/address expression
```

**`BaseDiagramNode`** (lines 90–127): add the same four fields (mirrors metadata for direct field access pattern used throughout the codebase).

**After line 143**: add `export interface DemuxDiagramNode extends BaseDiagramNode { kind: 'demux'; }`

**`DiagramNode` union** (lines 146–162): add `| DemuxDiagramNode`

### File: `src/ir/nodeMetadata.ts`

Add after `repeatExpressionSource()` (line 75):
```typescript
export function nodeIsArrayNode(node: DiagramNode): boolean {
  return node.isArrayNode === true || node.metadata?.isArrayNode === true;
}

export function nodeArrayDimension(node: DiagramNode): string | undefined {
  return node.arrayDimension ?? node.metadata?.arrayDimension;
}

export function nodeArraySize(node: DiagramNode): number | undefined {
  return node.arraySize ?? node.metadata?.arraySize;
}
```

---

## Layer 3 — TypeScript Extractor

### File: `src/parser/uhdmExtractor.ts`

The raw JSON from the C++ backend passes through `transformToDesignGraph` (line 1453). Wherever raw node metadata fields are mapped onto `DiagramNode` fields, add the four new fields. Also add `'demux'` wherever the raw kind string is validated or compared.

---

## Layer 4 — Node Sizing

### File: `src/diagram/nodeSizing.ts`

**Demux height** (after the `'mux'` case around line 73):
```typescript
case 'demux':
  return muxHeightForPortRows(portRows);
```

**Demux width** (after the mux width case around line 157):
Reuse the mux width computation path — demux has the same structural footprint.

**Array shadow padding**: After computing `width` and `height` for any node, if `nodeIsArrayNode(node)` add `8` to both (2 shadow layers × 4px step) so ELK routes edges clear of the shadow:
```typescript
const arrayPad = nodeIsArrayNode(node) ? 8 : 0;
return { width: w + arrayPad, height: h + arrayPad };
```

---

## Layer 5 — ELK Layout Port Geometry

### File: `src/layout/mergeLayout.ts`

**Demux port geometry** (inside `elkNodeForDiagramNode`, after the `mux`/`select` branch around line 263):

Demux is structurally identical to a mux but the single data `in` port sits on WEST (left), the array `out` port on EAST (right), and the `sel` (address) port on NORTH (top). Reuse the existing mux port distribution logic:
```typescript
} else if (node.kind === 'demux') {
  if (port.name === 'sel') {
    side = ElkPortSide.NORTH;
    portX = width / 2;
    portY = 0;
  } else if (port.direction === 'output') {
    side = ElkPortSide.EAST;
    portX = width;
    portY = height / 2;
  } else {
    side = ElkPortSide.WEST;
    portX = 0;
    portY = height / 2;
  }
}
```

---

## Layer 6 — Rendering

### Visual stacking spec (3 layers)

```
          ┌──────────────┐  ← FRONT layer: 100% opacity, shifted (-4px, -4px), cosmetic only
        ┌──────────────┐ │  ← MIDDLE layer: 75% opacity, at (0,0) — GRID ALIGNED, real ports here
      ┌──────────────┐ │ │  ← BACK layer: 50% opacity, shifted (+4px, +4px), cosmetic only
      │              │ │ │
      │   REGISTER   │ │─┘
      │      q       │─┘
      └──────────────┘
```

- **Middle layer** is the React Flow node element at grid-snapped coordinates — edges connect here
- **Front layer** (100%): child `<div>` shifted `(-4px, -4px)` from the container; higher z-index; cosmetic only
- **Back layer** (50%): child `<div>` shifted `(+4px, +4px)` from the container; lower z-index; cosmetic only
- Edge routing and React Flow handles live exclusively on the middle layer
- The front/back layers carry no handles and pointer-events are disabled on them
- ELK node sizing adds `4px` margin on the top/left sides (for front overhang) and `4px` on the bottom/right (for back overhang)

### File: `src/webview/main.tsx`

**Import** `nodeIsArrayNode`, `nodeArrayDimension`, `nodeArraySize` from `../ir/nodeMetadata`.

**Array helpers** (add near top of `HdlNode`, before the kind branches):
```tsx
const arrayDim = nodeArrayDimension(node);
const isArray = nodeIsArrayNode(node);

// Front layer: 100% opaque, shifted (-4px, -4px) — highest z-index, cosmetic
// Back layer: 50% opaque, shifted (+4px, +4px) — lowest z-index, cosmetic
const arrayLayers = isArray ? (
  <>
    <div className="hdl-node-array-layer hdl-node-array-front" aria-hidden="true" />
    <div className="hdl-node-array-layer hdl-node-array-back" aria-hidden="true" />
  </>
) : null;

const arrayBadge = isArray && arrayDim ? (
  <div className="hdl-node-array-badge" aria-hidden="true">{arrayDim}</div>
) : null;
```

**Register branch** (around line 970):
- Add `hdl-node-array` class to the `<button>` when `isArray`
- Inject `arrayLayers` as first children of the button
- Inject `arrayBadge` inside the header area
- The actual register content (ports, handles, labels) remains on the middle layer (the button itself)

**Demux branch** (add before the generic fall-through around line 1093): A demux renders like a mux — reuse `MuxSkin` for first pass. Mirror the mux rendering branch with:
- `className="hdl-node hdl-node-demux hdl-node-mux"` (borrows mux styles)
- `"addr"` label on the selector handle instead of `"s"`
- Input port labeled with data signal name
- Output port on right
- Same `arrayLayers` / `arrayBadge` injection if the demux `isArrayNode`

**`formatNodeKind`** function: add `'demux': 'DEMUX'` entry.

### File: `src/webview/styles.css`

**Array layer foundation** (add after register styles):
```css
/* Middle layer = the node itself; this just ensures overflow:visible for the cosmetic layers */
.hdl-node-array {
  overflow: visible;
  /* Middle layer is at 75% opacity */
  opacity: 0.75;
}

/* Restore full opacity for the front layer which renders over the middle */
.hdl-node-array .hdl-node-array-front {
  opacity: calc(1 / 0.75); /* compensate for parent opacity — or use isolation trick below */
}
```

**Opacity isolation note**: CSS `opacity` on a parent applies to all children multiplicatively. To get independent opacity on each layer, render them as siblings in a wrapper `<div>` rather than children of the node element, OR use `isolation: isolate` + `mix-blend-mode`. The simplest approach: wrap the three layers in a `<div className="hdl-node-array-stack">` container that is positioned by React Flow, and make each layer absolutely positioned within it:

```tsx
// In JSX — array node wrapper pattern:
<div className="hdl-node-array-stack" style={containerStyle}>
  <div className="hdl-node-array-layer hdl-node-array-back">
    {/* cosmetic copy of node shape */}
  </div>
  <div className="hdl-node-array-layer hdl-node-array-middle">
    {/* REAL node content: ports, handles, badge */}
    {arrayBadge}
    {/* ... register/demux JSX ... */}
  </div>
  <div className="hdl-node-array-layer hdl-node-array-front">
    {/* cosmetic copy of node shape */}
  </div>
</div>
```

```css
.hdl-node-array-stack {
  position: relative;
}

.hdl-node-array-layer {
  position: absolute;
  inset: 0;
  border: 1px solid var(--svsch-array-border-color, var(--vscode-panel-border));
  background: var(--vscode-editorWidget-background);
  border-radius: inherit;
  pointer-events: none;
}

.hdl-node-array-back {
  opacity: 0.5;
  transform: translate(4px, 4px);
  z-index: 0;
}

.hdl-node-array-middle {
  opacity: 0.75;
  transform: translate(0, 0);
  z-index: 1;
  pointer-events: auto; /* handles live here */
}

.hdl-node-array-front {
  opacity: 1.0;
  transform: translate(-4px, -4px);
  z-index: 2;
  pointer-events: none;
}
```

**Array badge** (positioned within the middle layer):
```css
.hdl-node-array-badge {
  background: color-mix(in srgb, var(--vscode-charts-blue) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 50%, transparent);
  border-radius: 3px;
  color: var(--vscode-charts-blue);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 10px;
  line-height: 1;
  padding: 1px 4px;
  pointer-events: none;
  position: absolute;
  right: 4px;
  top: 3px;
  z-index: 3;
}
```

**Per-kind border color** (propagated via CSS variable so cosmetic layers share it):
```css
.hdl-node-register .hdl-node-array-layer { --svsch-array-border-color: var(--vscode-charts-green); }
.hdl-node-mux .hdl-node-array-layer      { --svsch-array-border-color: var(--vscode-charts-purple); }
.hdl-node-demux .hdl-node-array-layer    { --svsch-array-border-color: var(--vscode-charts-purple); }
```

**Demux node**:
```css
.hdl-node-demux {
  /* inherits from .hdl-node-mux for first pass */
}
```

---

## Test Fixtures

Add `test/fixtures/array_register.sv`:
```sv
module array_register #(parameter SIZE = 8) (
    input logic clk,
    input logic rst,
    input logic write_en,
    input logic [$clog2(SIZE)-1:0] address,
    input logic [31:0] write_data,
    output logic [31:0] read_data
);
    reg [31:0] M [0:SIZE-1];

    always_ff @(posedge clk or posedge rst) begin
        if (rst) M[address] <= '0;
        else if (write_en) M[address] <= write_data;
    end

    assign read_data = M[address];
endmodule
```

Add unit tests in `test/unit/backend.test.ts` asserting:
- `graph.modules.array_register.nodes.some(n => n.kind === 'demux')` for the write path
- The demux node has `isArrayNode === true` or the paired register does
- `arrayDimension === '[0:7]'` on the array register node

Add visual test in `test/visual/` using a fixture with a simple array to generate a baseline screenshot showing the stacked register shadow.

---

## Build & Verification

1. Rebuild C++ backend: `cd src/parser/backend_cpp/build && cmake --build . && cp svsch_backend ../../../dist/`
2. Run unit tests: `npx vitest run` — all 188 existing tests must still pass
3. Run new array unit tests
4. Run visual tests: `npx playwright test` — generate new baseline for stacked register screenshot
5. Manual smoke test: open a design with an array register in VS Code and verify stacked visual + badge + demux node appear

---

## Implementation Sequence

```
Phase 1 (C++ — must come first):
  extractor.hpp: add Module.arrayDimensions maps + Node.metadata array fields
      → modules.inc: populate maps during variable scan
      → procedural.inc: tag registers + emit demux for variable-index writes
      → serialization.inc: serialize new fields
      → rebuild binary

Phase 2 (parallel once Phase 1 spec is stable):
  2A: types.ts → add demux kind, array fields, DemuxDiagramNode
  2B: nodeSizing.ts → demux sizing + array shadow padding

Phase 3 (depends on 2A):
  nodeMetadata.ts → array helper functions

Phase 4 (depends on 2A, 2B, 3):
  mergeLayout.ts → demux ELK port geometry + array shadow margin

Phase 5 (depends on 2A, 3 — parallel with 4):
  styles.css → shadow layers, badge, demux CSS
  main.tsx → arrayBadge/arrayShadows helpers + inject into register branch
  main.tsx → demux renderer branch

Phase 6 (depends on 4, 5):
  uhdmExtractor.ts → pass new fields from raw JSON
  Test fixtures + unit tests
  Visual test baseline
```

Phases 2A, 2B, and 5 can be prototyped using manually-constructed test data before the C++ backend is done.
