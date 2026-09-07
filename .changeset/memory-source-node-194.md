---
"svsch": minor
---

Represent declaration-only memories (e.g. `logic mem [0:N-1];` read via `assign instr = mem[addr];` with no procedural write) as a register-kind source node feeding the read mux, instead of leaving its `in` port silently dangling. The synthesized node is flagged `inferred` with a `reason`, and surfaces a warning diagnostic explaining the memory is declared but never written.
