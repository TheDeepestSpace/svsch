---
"svsch": patch
---

Refactor node rendering: split the monolithic `HdlNode.tsx` if-chain into self-contained per-kind components (register/latch, replicate, literal, inverter, mux/select, alu, comb/loop, instance, port) that each call a shared `HdlNodeBase`, and dedupe the `isBusComposition()` ternary, the `hasArrayConnection`/`arrayConnectionThick` helpers, and the array-stack-skin rect JSX that were copy-pasted across every node-kind SVG file. No render/visual changes — verified with a new render-snapshot regression test covering every node kind. Bus/struct/interface rendering is intentionally left as-is for a follow-up (tracked in issue #172).
