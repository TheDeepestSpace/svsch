---
"svsch": patch
---

Fix nested ternary mux nodes reusing the whole assign statement's source range instead of their own sub-expression's range.
