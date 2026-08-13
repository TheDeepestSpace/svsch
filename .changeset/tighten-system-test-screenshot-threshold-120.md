---
"svsch": patch
---

Tighten the system-test full-window screenshot budget (`maxDiffPixels: 2500` → `500`) and regenerate the stale 1.90.0/1.91.0/1.122.1 baselines. The old budget was high enough that the inline toolbar warning-count label (added in #120) could disappear from a baseline entirely — a 2195px diff — without `--update-snapshots` rewriting it or CI's assertion failing, silently letting a real regression pass.
