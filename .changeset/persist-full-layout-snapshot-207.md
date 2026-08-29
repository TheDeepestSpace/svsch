---
"svsch": patch
---

Persist every node's resolved position and every edge's resolved route into the layout snapshot on each render, not just explicitly pinned nodes or manually-dragged routes, so an auto-laid-out (never-dragged) module can still recover its layout after a crash.
