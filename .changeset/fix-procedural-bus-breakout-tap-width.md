---
"svsch": patch
---

Fix a bus breakout tap (e.g. `data_i[3:0]`) rendering as a thin single-bit wire on the source side of the connection when the breakout came from separate procedural statements (`always_comb begin hi_o = data_i[7:4]; lo_o = data_i[3:0]; end`) rather than a continuous `assign`. UHDM doesn't report a usable width for a numeric part-select taken from a reg-driven (procedural) LHS the way it does for a net-driven (continuous-assign) one, so the tap's width now falls back to the slice embedded in its own signal name.
