---
"svsch": minor
---

Add a v1 "Partial Diagram" feature: select one or more nodes in the main diagram and click "Add to Partial [P]" to clone them (all wires cut) into an ephemeral "SVSCH Partial Diagram" pane. Hovering a cut-net end reveals an "Extend" arrow that pulls in every node on that net (all branches, for a fanout net) and ties it within the partial. The pane is reused by subsequent "Add to Partial" clicks and its state is fully discarded on close.
