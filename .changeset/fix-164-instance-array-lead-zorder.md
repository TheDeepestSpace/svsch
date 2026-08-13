---
"svsch": patch
---

Fix stacked instance-array nodes drawing their left-side (input) port leads on top of the node body, obscuring the `u_child[0]` label, in both the live canvas and exported SVG. CSS z-index doesn't govern paint order for these elements — only raw draw order does — so the front (topmost) card must be the very next element painted after the leads, ahead of the back/middle stack layers, or the leads still bleed through.
