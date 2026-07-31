---
"svsch": patch
---

Raise the BDD module-render wait timeout (60s → 120s, with a matching bump to the overall Playwright test timeout) and retry once in CI, to absorb React Flow's async, browser-scheduled edge-handle measurement pass lagging under CPU-starved CI. No application code changed — `.react-flow__edge` DOM mounting is decoupled from the underlying model update by React Flow itself, so this was a genuine CI-scheduling flake (seen across unrelated scenarios), not a rendering regression.
