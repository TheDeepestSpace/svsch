---
"svsch": patch
---

Highlight new (green) and modified (orange) scenario cards in the BDD video gallery, with New/Modified/Unchanged/All filters alongside the existing search box. `publish_bdd_videos` now fetches the PR base ref and diffs `test/features/**/*.feature` against head to classify each scenario.
