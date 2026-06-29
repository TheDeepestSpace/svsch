# MODE Override With Simple Generate Case

This fixture is a sibling of `../mode-no-default-overridden/`, but it removes the multi-label `1, 2:` case item.

Instead, the generate case uses separate single-label arms:

```systemverilog
case (MODE)
  0: begin : g_case_0
  1: begin : g_case_1
  2: begin : g_case_2
  default: begin : g_case_default
endcase
```

The wrapper still overrides the no-default child parameter with `.MODE(2)`.

## Result

Surelog succeeds. In the folded UHDM source-side `_gen_case`, all arm bodies are present:

- `g_case_0` contains `u_c0`
- `g_case_1` contains `u_c1`
- `g_case_2` contains `u_c2`
- `g_case_default` contains the `assign w_case = 1'b0`

The selected elaborated generated scope is still only the active arm:

- `work@wrapper.u_child.g_case_2`
- `work@wrapper.u_child.g_case_2.u_c2`

This suggests the missing body in `../mode-no-default-overridden/` is tied to the multi-label `1, 2:` case item rather than the parent override/no-default-parameter setup by itself.

## Files

- `override_probe_simple_case.sv`: source fixture.
- `folded.dump`: normal `uhdm-dump` output.
- `elab.dump`: `uhdm-dump` output from the `-elabuhdm` run.
- `folded.stats.txt`: object counts from the folded run.
- `elab.stats.txt`: object counts from the `-elabuhdm` run.
- `hierarchy.txt`: `uhdm-hier --line` output.
- `status.txt`: Surelog output from the folded run.
- `elab-status.txt`: Surelog output from the `-elabuhdm` run.

Useful anchors:

- `folded.dump:669`: source-side `_gen_case`.
- `folded.dump:689`: `g_case_0` source arm with `u_c0`.
- `folded.dump:732`: `g_case_1` source arm with `u_c1`.
- `folded.dump:775`: `g_case_2` source arm with `u_c2`.
- `folded.dump:810`: `g_case_default` source arm.
- `folded.dump:1472`: selected elaborated `vpiGenScopeArray` for `g_case_2`.
