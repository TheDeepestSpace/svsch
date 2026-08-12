---
"svsch": patch
---

Fix stacked instance-array nodes drawing their left-side (input) port leads on top of the node body, obscuring the `u_child[0]` label. The leads are now painted before the stacked body layers, matching the draw order already used by register and mux stacks.
