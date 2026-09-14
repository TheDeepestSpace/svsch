---
"svsch": patch
---

Split the single repo-wide `gh-pages-publish` concurrency group into per-job+per-ref groups (with `cancel-in-progress: true`) across `ci.yml`, `ci-duration.yml`, `cleanup-video-galleries.yml`, `master-dashboard.yml`, `coverage-history.yml`, `backend-coverage-history.yml`, and `mem-profile-history.yml` — the shared group serialized every PR's stats jobs and every master push behind each other, turning several ~1min jobs into hours of wall-clock waiting. Since concurrent pushes to `gh-pages` are now expected rather than lock-avoided, also raise the git-push retry cap from 3 (no delay) to 25 with exponential backoff and jitter across all 9 history-recorder scripts with that retry loop.
