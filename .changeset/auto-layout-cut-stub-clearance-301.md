---
"svsch": patch
---

Auto Layout now feeds free cut-net-end labels into ELK's own node placement as real graph participants — wired to their owning port like any other node — instead of deriving their position afterward from a geometric collision search. This lets ELK's layered algorithm account for cut labels alongside the rest of the diagram, substantially cutting down on overlaps in larger designs. The slot ELK reserves is not where the label renders, though: each label is pulled back to sit right against its owning port's lead point whenever that spot is clear, walking outward toward ELK's reservation only when it isn't — so cut ends stay as tight to their node as before, without the overlaps. The old collision search and obstacle-avoiding stub routing remain as a safety net.
