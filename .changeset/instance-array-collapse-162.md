---
"svsch": minor
---

Collapse `[MSB:LSB]` instance arrays into a single stacked instance node instead of emitting N separate nodes with N redundant submodule elaborations. The extractor now detects UHDM's `vpiModuleArray` container, elaborates the submodule once, and stamps the collapsed node with `isArrayNode`/`arrayDimension`/`arraySize`, reusing the existing array-stack rendering. Per-port connections are classified as broadcast vs element-wise per LRM 23.2.
