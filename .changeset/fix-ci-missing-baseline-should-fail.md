---
"svsch": patch
---

Fail BDD snapshot/screenshot comparisons in CI when a baseline is missing instead of silently writing the actual output as the new baseline and passing. This previously let scenarios with no committed baseline pass vacuously. Local runs and `UPDATE_SNAPSHOTS=true` still auto-create baselines as before.
