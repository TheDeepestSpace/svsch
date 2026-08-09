---
"svsch": patch
---

Fix duplicate selection outlines on shaped nodes (scalar mux, select, ALU, and inverter) by removing the redundant rectangular selection element and relying on the node's own SVG shape outline for selection. Array-node selection rectangles are unchanged.
