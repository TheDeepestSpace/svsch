---
"svsch": patch
---

Persist every node's resolved position into the layout snapshot on each render, not just explicitly pinned nodes, so an auto-laid-out (never-dragged) module can still recover its layout after a crash.
