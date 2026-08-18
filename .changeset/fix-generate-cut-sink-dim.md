---
"svsch": patch
---

Fix the shared sink cut-net label on a declared net driven by mutually exclusive generate arms rendering dimmed when the target port is actually always driven by whichever arm is active. The dedupe now keeps the active arm's label instead of whichever arm's edge id happened to sort first.
