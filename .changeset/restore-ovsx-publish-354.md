---
"svsch": patch
---

Restore Open VSX Registry publishing (`npx ovsx publish`) in the release script, needed so `svsch` can be installed in Cursor and other Open VSX–based editors. Falls back gracefully (`|| echo 'Open VSX skipped'`) if `OVSX_PAT` is missing or expired, so a publish failure here won't block the npm package publish or VSIX/GitHub release attachment.

Note: this requires a repo admin to add an `OVSX_PAT` secret (Settings → Secrets and variables → Actions) for a real Open VSX publish to happen — until then the fallback will silently no-op.
