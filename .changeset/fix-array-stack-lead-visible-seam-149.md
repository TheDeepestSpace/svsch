---
"svsch": patch
---

Fix array-stack lead stubs rendering as visible duplicate/overlapping marks where they met the array net's own stacked lines (mux `sel`/side ports, register D/Q/R, array ports). Leads now extend exactly to where the routed wire's matching layer begins, so the two form one continuous, seamless line.
