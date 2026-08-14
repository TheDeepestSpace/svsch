---
"svsch": patch
---

Reduce visual-suite benchmark noise by sampling elaboration and rendering timings median-of-5 instead of once. `buildDesignGraph()` runs 5x per fixture build (free, no extra I/O) and the view is re-opened 5x per test for rendering samples; the screenshot assertion itself still runs once. The system suite is unaffected — its "sample" is a full VS Code boot, not comparable.
