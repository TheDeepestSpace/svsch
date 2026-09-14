---
"svsch": patch
---

Scope zero-extension nodes in case-statement muxes to their own arm's source range instead of the whole case statement, so selecting inside one arm no longer highlights sibling arms' zext nodes and edges.
