---
"svsch": patch
---

Extract SystemVerilog function/task declarations and call sites from UHDM, render function calls as a distinct node kind, and allow each function call-site to expand its combinational body in place with persisted expansion state.
