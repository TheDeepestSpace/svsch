---
"svsch": patch
---

Fix an unconditional `always_comb` assignment whose RHS is a bus composition or replication (e.g. `imm = {{(DATA_WIDTH-4){instr[3]}}, instr[3:0]};`) rendering with a spurious "COMBINATIONAL" box between the composition and the output port, where a plain wire was expected. The block only has one statement, so there's nothing for the extra node to disambiguate — it existed only because procedural assignments route the RHS through a `<signal>_next` intermediate name, which now no longer applies to concat/replication RHS in this single-statement case, matching how inverter RHS was already handled.
