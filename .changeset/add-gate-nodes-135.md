---
"svsch": minor
---

Add first-class boolean gate nodes (AND/OR/XOR/NAND/NOR/XNOR) with n-ary flattening for same-operator chains (`a&b&c&d` renders as one 4-input AND instead of a cascade), replacing the undifferentiated `comb` blob these expressions previously collapsed into. `(a|b)&c` still renders as OR-feeding-AND — flattening never crosses operator types. NOT already had a dedicated `inverter` glyph and is unchanged. Gate input ports fan out one full grid line apart regardless of input count, growing the gate body to fit instead of falling back to tighter centered spacing for 4+ inputs.
