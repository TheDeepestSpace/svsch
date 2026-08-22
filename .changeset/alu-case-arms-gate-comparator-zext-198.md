---
"svsch": minor
---

Extend the `alu`/`inverter` "operator → dedicated node kind" pattern to ALU-style case arms selected by a `case` statement (e.g. an `alu_op` mux). Bitwise/logical `&`/`|`/`^`/`&&`/`||` now get a dedicated `gate` node, comparisons (`<`, `<=`, `>`, `>=`, `==`, `!=`, `===`, `!==`) get a dedicated `comparator` node with a 1-bit output, and a new `zext` node is inserted when a case arm's driving signal is narrower than the mux's resolved output width.
