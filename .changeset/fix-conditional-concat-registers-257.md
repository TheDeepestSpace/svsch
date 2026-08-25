---
"svsch": patch
---

Fix duplicate register nodes, multi-driver D inputs, and displaced layout for conditional concat-LHS register assignments. Also fix a regression where the bus-composition node for a concat-LHS register (e.g. `{a[2], a[1:0]} <= ...`) wired the pre-register combinational value into the merge instead of the registers' Q outputs, leaving the registers disconnected.
