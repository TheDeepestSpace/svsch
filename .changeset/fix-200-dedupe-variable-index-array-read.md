---
"svsch": patch
---

Fix continuous variable-index reads from locally written arrays (e.g. `assign read_data = ram[addr];`) emitting a duplicate `select` node alongside the read mux. Arrays with parameterized-but-elaborated unpacked extents are now registered in `mod.arrayDimensions` up front, so the continuous read lowers once to the scalar read mux.
