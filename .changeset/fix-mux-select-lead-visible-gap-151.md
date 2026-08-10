---
"svsch": patch
---

Fix a visible gap between a mux/select node's `sel` array-stack lead stub and the node's own slanted top edge, caused by a 1.5px pull-back (`ARRAY_STACK_LEAD_EDGE_GAP`) that left the front-layer stub short of the boundary it's meant to be hidden under. The lead now touches the skin edge exactly, matching every other side.
