---
"svsch": patch
---

Fix duplicate register nodes, multi-driver D inputs, and displaced layout for conditional concat-LHS register assignments. Also fix a regression where the bus-composition node for a concat-LHS register (e.g. `{a[2], a[1:0]} <= ...`) wired the pre-register combinational value into the merge instead of the registers' Q outputs, leaving the registers disconnected.

Also fix multi-bit constant part-select registers (e.g. `a[1:0]`) reporting a 1-bit D/Q width instead of their real width, which under-sized their wires and threw off the total width of any bus-composition node they fed into.

Also fix bus-composition nodes leaving a literal RHS concat segment (e.g. the `1'b0` in `{data_reg, 1'b0}`) unconnected: no node was ever synthesized for the literal, so its port dangled with no wire.
