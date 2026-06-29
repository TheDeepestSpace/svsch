# MODE With No Default

This fixture changes the original generate probe from:

```systemverilog
parameter int MODE = 2
```

to:

```systemverilog
parameter int MODE
```

Surelog 1.84 still writes UHDM, but exits with errors:

- `Top-level parameter with no default value "MODE"`
- `Invalid generate case stmt value`

The written UHDM still includes active generated scopes. In this run, Surelog compiled `work@top.g_case_0`, apparently because the unresolved parameter is treated as a zero-like value during partial elaboration. That should not be treated as a valid semantic decision for the diagram.

Files:

- `generate_probe_mode_no_default.sv`: source fixture.
- `folded.dump`: normal `uhdm-dump` output.
- `elab.dump`: `uhdm-dump` output from the `-elabuhdm` run.
- `folded.stats.txt` and `elab.stats.txt`: stats-only object counts.
- `hierarchy.txt`: `uhdm-hier --line` output.
- `focused-excerpts.txt`: compact excerpts showing the errors, missing parameter RHS, generate-if tree, and active `g_case_0` generated scope.
