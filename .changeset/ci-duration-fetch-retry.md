---
"svsch": patch
---

Fix `publishCiDurationHistory` CI script: a transient network failure on the `gh-pages` fetch or worktree checkout now retries along with the push, instead of throwing immediately and skipping the existing 3-attempt retry loop.
