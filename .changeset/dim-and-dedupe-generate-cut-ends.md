---
"svsch": patch
---

Dim automatic cut-net labels on inactive generate-arm wires to match the rest of the dimmed route. When a declared net is driven by more than one mutually exclusive generate arm, every arm's edge is still auto-cut (none are left wired directly into the output), but only one overlapping sink cut end renders at the shared target port instead of stacking a redundant one on top.
