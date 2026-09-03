---
"svsch": minor
---

Support structural combinational feedback loops (e.g. cross-coupled NAND SR latches): the loop renders as a cyclic feedback edge between the gates, the edges that close it are stamped with `combFeedback` metadata, and a per-loop warning diagnostic names the signals involved. Clocked feedback through registers/latches is never flagged.
