---
"svsch": patch
---

Fix a spurious `zext` node appearing on case arms whose RHS is a procedural concatenation with a parameterized replication count (e.g. `imm = {{(DATA_WIDTH-4){instr[3]}}, instr[3:0]};`). UHDM doesn't always fold a parameterized repeat-count expression to a constant when the replication is nested inside a concat operand, so the replication's width was momentarily seen as 1 bit at the point `lowerCaseStatement` decided whether the case arm needed zero-extension into the mux — inserting a zext that a later width-repair pass could no longer retract even after it corrected the replication's own width. The repeat count is now resolved from known parameter values as soon as the replication node is created, so the correct width is visible immediately and no zext is inserted when none is needed.
