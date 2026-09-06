---
"svsch": patch
---

Fix gh-pages push races across PR-stats CI scripts (coverage, benchmark, CI-duration, and memory stats): concurrent workflow runs publishing to `gh-pages` at the same time could clobber each other's commits. All publish steps now serialize through a shared concurrency group instead of racing independently, and are additionally chained via `needs` so no more than one job claims the group's single pending slot at once — GitHub Actions cancels a still-pending job when a new one queues for the same group, which was silently dropping PR-stats jobs whenever three or more became ready at the same instant.
