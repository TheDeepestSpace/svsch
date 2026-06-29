# UHDM Generate If/Case Dump Notes

These files come from `generate_probe.sv`, a small module with:

- an explicit `generate if/else`
- an explicit `generate case`
- an implicit module-item generate `if/else`

Files:

- `generate_probe.sv`: the source fixture used for the dump.
- `folded.dump`: `uhdm-dump` output from the normal Surelog `-parse` run.
- `elab.dump`: `uhdm-dump` output from the Surelog `-elabuhdm` run.
- `folded.stats.txt` and `elab.stats.txt`: object-count summaries.
- `hierarchy.txt`: `uhdm-hier --line` for the folded UHDM file.
- `focused-excerpts.txt`: trimmed sections showing the generate-if trees and the active generated case scope.

Main observation: this Surelog/UHDM 1.84 output exposes `gen_if_else` objects with true and else arm statements, but the probe did not emit `gen_case` or `case_item` objects. The selected case arm is present as an active `gen_scope_array` named `work@top.g_case_12`; inactive case arms are not present in the dump.
