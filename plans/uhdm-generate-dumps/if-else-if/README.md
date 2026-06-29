# Generate If / Else If / Else

This fixture checks how Surelog/UHDM represents:

```systemverilog
if (SEL == 0) begin : g_if_0
end else if (SEL == 1) begin : g_if_1
end else begin : g_if_default
end
```

with `SEL = 1`.

Observation:

- The folded UHDM source tree contains all three arm bodies: `g_if_0`, `g_if_1`, and `g_if_default`.
- The `else if` is represented as a nested `_gen_if_else` inside the outer `vpiElseStmt`, not as a flat three-arm object.
- The active elaborated generated scope is only `work@top.g_if_1`.

Files:

- `generate_if_else_if_probe.sv`: source fixture.
- `folded.dump`: normal `uhdm-dump` output.
- `folded.stats.txt`: stats-only object counts.
- `hierarchy.txt`: `uhdm-hier --line` output.
- `focused-excerpts.txt`: compact excerpts showing the nested `_gen_if_else` tree and active `g_if_1` scope.
- `status.txt`: Surelog command output.
