---
"svsch": patch
---

Fix parameterized procedural concatenations (e.g. `{(DATA_WIDTH-4){instr[3]}}, instr[3:0]}`) mislabeling their concat operand widths (e.g. `[1]`/`[0]` instead of `[7:4]`/`[3:0]`) even though the overall output width was correct. Replication and aggregate widths are now resolved before concat inputs are relabeled, and width resolution now falls back to inferring a width from a slice embedded in the operand's signal name.
