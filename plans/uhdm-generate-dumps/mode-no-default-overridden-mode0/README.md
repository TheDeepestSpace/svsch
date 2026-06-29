# MODE=0 Override Probe

This fixture is the same as `../mode-no-default-overridden/override_probe.sv`, except the wrapper instantiates:

```systemverilog
child #(.MODE(0)) u_child (.a(w), .y(y));
```

Surelog/UHDM completed successfully for both folded and `-elabuhdm` runs.

## Files

- `override_probe_mode0.sv`: source fixture with `.MODE(0)`.
- `folded.dump`: full UHDM dump from the default folded run.
- `elab.dump`: full UHDM dump from the `-elabuhdm` run.
- `folded.stats.txt`: object counts from `folded.dump`.
- `elab.stats.txt`: object counts from `elab.dump`.
- `hierarchy.txt`: Surelog hierarchy output from the folded run.
- `status.txt`: Surelog status output from the folded run.

## Difference from MODE=2

The source-side generated-case structure is materially the same. The main difference is the parameter override value and the active elaborated generated scope:

- MODE=2: `vpiDecompile:2` / `UINT:2`, active scope `work@wrapper.u_child.g_case_12`, instance `u_c12`.
- MODE=0: `vpiDecompile:0` / `UINT:0`, active scope `work@wrapper.u_child.g_case_0`, instance `u_c0`.

The folded object stats are unchanged apart from the file path in the stats header. The hierarchy similarly changes only by selecting `g_case_0/u_c0` instead of `g_case_12/u_c12`.

Useful anchors in the MODE=0 folded dump:

- `folded.dump:1105`: parameter override RHS is `0`.
- `folded.dump:1253`: active `vpiGenScopeArray` is `work@wrapper.u_child.g_case_0`.
- `folded.dump:1264`: active module instance is `work@wrapper.u_child.g_case_0.u_c0`.
