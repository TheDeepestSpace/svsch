---
"svsch": patch
---

Highlight new (green), modified (orange), and removed (red) scenario cards in the BDD video gallery, with New/Modified/Removed/Unchanged/All filters alongside the existing search box. `publish_bdd_videos` now fetches the PR base ref and diffs `test/features/**/*.feature` against head to classify each scenario.
