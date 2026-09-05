---
"svsch": patch
---

Fix gh-pages push races across PR-stats CI scripts (coverage, benchmark, CI-duration, and memory stats): concurrent workflow runs publishing to `gh-pages` at the same time could clobber each other's commits. All publish steps now serialize through a shared concurrency group instead of racing independently.
