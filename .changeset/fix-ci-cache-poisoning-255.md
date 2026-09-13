---
'svsch': patch
---

Fix CI npm cache poisoning: non-`setup` jobs now use `actions/cache/restore` (read-only) for `node_modules` instead of `actions/cache`, preventing a stale restore from being re-saved under the current lockfile's key and masking a skipped `npm ci`.
