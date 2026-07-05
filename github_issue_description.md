# Bug: Bus Composition Node Renders Incorrect Bit-Slice Branch Names

## Description
When performing bus composition using a mix of single-bit and multi-bit vector slices (e.g., `{a, b[1:0]}`), the inferred bus composition node does not aggregate the multi-bit slice branch into a single grouped branch name (e.g., `[1:0]`). Instead, it incorrectly decomposes it and outputs individual bit taps/branches (like `[1]` and `[0]`).

## Repro Steps / SV Code
```systemverilog
module top (
  input logic a,
  input logic [3:0] b,
  output logic [2:0] y
);
  assign y = {a, b[1:0]};
endmodule
```

## Expected Behavior
The composition node representing `{a, b[1:0]}` should render:
- A single-bit branch labeled `[2]` (or mapping to `a`)
- A multi-bit slice branch labeled `[1:0]` (mapping to `b[1:0]`)

## Actual Behavior
The rendered SVG/diagram tap ports show:
- Branch `[2]` for `a`
- Branch `[1]` and branch `[0]` as separate ports/taps for `b[1:0]` instead of a unified `[1:0]` branch.
