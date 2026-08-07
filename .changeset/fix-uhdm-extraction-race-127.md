---
"svsch": patch
---

Fix a race in `extractDesignWithUhdm` where two concurrent calls for the same workspace could spawn Surelog against the same `cacheDir` simultaneously, corrupting one process's partial write and crashing the other's read (`kj::io ... Premature EOF`). Concurrent calls are now serialized per-`cacheDir`: a later caller waits for the earlier one to finish and re-checks the cache before spawning Surelog again.
