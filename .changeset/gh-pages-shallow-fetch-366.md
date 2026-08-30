---
"svsch": patch
---

Fix CI scripts that publish to `gh-pages` (`ci-duration.mjs`, `generate-coverage-stats.mjs`, `trim-benchmark-history.mjs`, `generate-benchmark-stats.mjs`, `generate-ci-duration-stats.mjs`) and the two `ci.yml` baseline-fetch steps to use `git fetch --depth=1` instead of a full fetch. None of these need `gh-pages` history — they only read the current tree via `worktree add --detach` or `git show`. `gh-pages`' full history has grown to several GiB from historical BDD video blobs, pushing full-fetch time to the edge of the network timeout; a shallow fetch bounds cost to the current tree size regardless of how large history grows.
