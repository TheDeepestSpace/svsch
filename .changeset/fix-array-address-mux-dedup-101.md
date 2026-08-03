---
"svsch": patch
---

Fix duplicate address-mux generation when an array has multiple indexed write statements in the same always block (e.g. a reset loop plus a per-index write). Indexed writes to the same array now share one array register and are chained through address-mux stages for each distinct index expression, instead of producing colliding duplicate nodes.
