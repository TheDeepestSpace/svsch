---
"svsch": patch
---

Fix action buttons (e.g. edge/connection controls, port selection handles) scaling with canvas zoom instead of staying a constant screen size. Buttons are now counter-scaled against the current zoom level so they render at a fixed visual size regardless of zoom.
