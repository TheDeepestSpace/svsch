---
"svsch": patch
---

Fix intermediate signal name collisions between nested `case` statements that reuse the same item label (e.g. two unrelated nested `case`s each with a `2'b01` item). Branch names are now scoped by the full nesting path instead of the item's own label alone, so unrelated literal nodes no longer fight over one synthesized signal name.
