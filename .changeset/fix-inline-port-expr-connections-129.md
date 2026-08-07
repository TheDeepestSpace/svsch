---
"svsch": patch
---

Fix instance-port connections that use a bit-select or literal inline (e.g. `.opcode(instr[7:4])`, `.b(8'd1)`) being silently dropped from the diagram. The instance-port-connection loop now synthesizes the same breakout/literal driver nodes that `processAssign` creates for `assign` statements, so `DesignExtractor::buildEdges`'s exact signal-string matching finds a node to connect to.
