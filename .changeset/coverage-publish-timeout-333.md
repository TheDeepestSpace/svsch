---
"svsch": patch
---

Fix coverage-summary CI script: a gh-pages publish timeout no longer discards a successfully-parsed coverage summary, since the publish step is now in its own try/catch instead of sharing one with the summary parsing.
