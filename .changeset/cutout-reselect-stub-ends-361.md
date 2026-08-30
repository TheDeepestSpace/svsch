---
"svsch": patch
---

Fix `Cut out`: the cut instance and the newly-created cut-net-end stub(s) landing on it are now reselected after the operation, so the group can be dragged immediately instead of requiring a manual reselect. Only the stub(s) directly attached to the cut-out instance join the group — the corresponding stub at the far end of each net, attached to whatever it was already connected to, is left alone.
