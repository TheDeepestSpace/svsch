# MODE With No Default, Overridden By Parent

This fixture keeps `MODE` without a default on `child`, but instantiates it from `wrapper` with `#(.MODE(2))`.

Surelog 1.84 succeeds in this case. The folded UHDM contains:

- a `_gen_case` source tree under `work@child`
- `_case_item` entries for each case arm
- an active `gen_scope_array` for `work@wrapper.u_child.g_case_12`

This is the useful contrast with `../mode-no-default/`, where `MODE` is an unbound top-level parameter and Surelog reports errors.

Files:

- `override_probe.sv`: source fixture.
- `folded.dump`: normal `uhdm-dump` output.
- `elab.dump`: `uhdm-dump` output from the `-elabuhdm` run.
- `folded.stats.txt`: stats-only object counts.
- `elab.stats.txt`: stats-only object counts from the `-elabuhdm` run.
- `hierarchy.txt`: `uhdm-hier --line` output.
- `focused-excerpts.txt`: compact excerpts showing the `_gen_case` tree and the active generated scope.
- `status.txt`: Surelog command output.
- `elab-status.txt`: Surelog command output from the `-elabuhdm` run.
