---
"svsch": patch
---

Fix duplicate address-mux generation when an array has multiple indexed write statements in the same always block. Distinct normal writes now share one array register and chain through address-mux stages, while proven full-range reset loops fold into that register's canonical reset and reset-value ports.
