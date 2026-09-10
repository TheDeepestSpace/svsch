---
"svsch": patch
---

Add a static orphaned-snapshot checker (`npm run test:snapshots:check-orphans -- <visual|system|bdd|all>`) that flags visual/system/BDD baseline files with no live test producing them, and wire it into CI as `check_snapshot_orphans`.
