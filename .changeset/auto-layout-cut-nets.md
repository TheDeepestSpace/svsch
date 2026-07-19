---
"svsch": patch
---

Fix "Auto Layout" so a cut net's dangling wire end moves along with the block it's attached to instead of staying stuck at a stale position. Selecting the block (or just its stub wire) now releases the dangling end too, even if the marquee didn't cover it directly; a dangling end whose wire isn't selected is left untouched.
