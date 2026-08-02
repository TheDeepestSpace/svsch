---
"svsch": patch
---

Fix duplicate address-mux generation when an array has multiple indexed write statements in the same always block (e.g. a reset loop plus a per-index write). All indexed writes to the same array now merge into a single address mux instead of producing colliding duplicate nodes.
