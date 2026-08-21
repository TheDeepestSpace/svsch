---
"svsch": patch
---

Fix the write-address mux for a whole-array reset loop (e.g. `for (int i = 0; i < N; i++) regs[i] <= '0;`) losing its selector wiring when the array's size bound is a parameterized expression like `(1<<ADDR_WIDTH)`. UHDM doesn't fold that bound to a constant the way it does for the array's own elaborated declaration range, so the reset loop was misdetected as an ordinary variable-index write keyed on the loop variable `i` — which has no driver — instead of being folded into the register's R/RV ports. The loop-bound expression is now evaluated by walking its operand tree and resolving parameter references against the module's own declared defaults.
