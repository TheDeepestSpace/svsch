---
"svsch": patch
---

Fix `captureGraphState()` grabbing the wrong `<path>` for an edge in the visual-regression harness. It selected the first path in the edge's DOM group, which is a jump-halo arc or net-highlight overlay when either is present, instead of the real wire stroke — causing flaky full-route vs tiny-arc JSON diffs with zero PNG diff. Now scoped to `path.svsch-edge`, the class token only the actual stroke paths carry.
