---
"svsch": minor
---

Store each module's diagram layout in its own file under `.svsch/layouts/<module>.json` instead of one monolithic `.svsch/layout.json`. This avoids Git merge conflicts when different developers edit different modules' layouts, and keeps every read/write scoped to the module that actually changed instead of the whole project's layout data.

This is a breaking change to the on-disk layout format: existing `.svsch/layout.json` files are no longer read, so saved node/edge/region positions will reset the first time you open a diagram after upgrading.
