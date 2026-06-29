# Nested Generate Blocks

This fixture checks four nested generate combinations:

- `if -> if`
- `case -> case`
- `if -> case`
- `case -> if`

The child modules are instantiated from `wrapper` with parameter overrides so Surelog has concrete values for elaboration and still preserves folded source trees for generate cases.

Observations from Surelog/UHDM 1.84:

- Folded source trees preserve nested generate structure directly.
- Nested `if` blocks appear as nested `_gen_if_else` objects.
- Nested `case` blocks appear as nested `_gen_case` objects with `_case_item` children.
- Mixed nesting appears as whichever generate object is inside the selected arm body, e.g. `_gen_if_else` containing `_gen_case`, or `_gen_case` containing `_gen_if_else`.
- Active generated scopes are nested as `gen_scope_array` children, with full names like `work@wrapper.u_case_case.g_outer_1.g_inner_2`.

Files:

- `nested_generate_probe.sv`: source fixture.
- `folded.dump`: normal `uhdm-dump` output.
- `folded.stats.txt`: stats-only object counts.
- `hierarchy.txt`: `uhdm-hier --line` output.
- `focused-excerpts.txt`: compact excerpts for all four nested cases plus active generated scopes.
- `status.txt`: Surelog command output.
