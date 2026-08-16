---
"svsch": patch
---

Reject sub-threshold snapshot updates in CI. Visual, BDD, and system Playwright configs now pin `UPDATE_SNAPSHOTS` to compare-first `changed` mode instead of `all`, and `test/steps/fixtures.ts`, `test/steps/diagram.steps.ts`, and the exact comparators in `test/graphRegression.ts` compare before writing a new baseline. A new snapshot gate (`scripts/check-snapshot-updates.ts`) runs on `test_visual`, `test_bdd`, and `test_system` PR jobs and fails the build if a changed baseline's pixel diff falls under its threshold (2 px/120 px for visual overrides, 50 px/100 px for raw pixelmatch), with an allowlist (`test/snapshot-bypass.yml`) for reviewed exceptions.
