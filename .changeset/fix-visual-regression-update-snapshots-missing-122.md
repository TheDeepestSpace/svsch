---
"svsch": patch
---

Fix `npm run test:visual` never actually failing on a mismatch. Playwright's `config.updateSnapshots` defaults to `'missing'` unless `--update-snapshots` is passed on the CLI, and the visual-regression helpers treated `'missing'` the same as `'all'`/`'changed'`, unconditionally taking the write-baseline early-return instead of comparing. Dropped `'missing'` from the update-snapshots condition in `test/visual/helper.ts` and `test/visual/elk_geometry.visual.spec.ts`, and regenerated the `loop-node-chromium-linux.json` baseline, which had gone stale since #110's edge-path-selector fix without ever being caught.
