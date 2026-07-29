---
"svsch": patch
---

Capture diagnostic node/edge state when the BDD `_waitForRenderedModule` render-completion check times out, so a recurrence of the intermittent "Navigating to combinational blocks" CI timeout is diagnosable from logs instead of a bare timeout.
