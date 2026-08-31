---
"svsch": patch
---

Auto Layout now feeds free cut-net-end labels into ELK's own node placement as real graph participants — wired to their owning port like any other node — instead of deriving their position afterward from a geometric collision search. This lets ELK's layered algorithm account for cut labels alongside the rest of the diagram, substantially cutting down on overlaps in larger designs; the old collision search and obstacle-avoiding stub routing remain as a safety net.
