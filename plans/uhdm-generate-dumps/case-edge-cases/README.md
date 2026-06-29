# Generate Case Edge Cases

These fixtures test when Surelog/UHDM preserves all source-side generate-case arm bodies in the folded dump.

Important vocabulary:

- `_gen_case` contains the source-side generate case and its `case_item` arms.
- `_gen_scope_array` contains only the selected elaborated generated scope for the current parameterization.

## Findings

Single-label case arms preserve all source-side arm bodies in the folded `_gen_case` across the shapes tested:

- `top_default_simple.sv`: top-level `parameter int MODE = 2` with explicit `generate/endgenerate`.
- `top_default_implicit_simple.sv`: same, but without explicit `generate/endgenerate`.
- `top_default_unnamed_simple.sv`: same, but arm bodies are unnamed generate items.
- `child_default_simple.sv`: child has `parameter int MODE = 2`, wrapper instantiates without override.

The comma-separated multi-label form consistently drops the multi-label arm body from the source-side `_gen_case`:

- `top_default_multi.sv`: `1, 2: begin : g_case_12 ... end`
- `child_default_multi.sv`: same syntax in a child module instantiated by a wrapper.

In those multi-label fixtures, `_gen_case` has the `g_case_0` body and the `default` body, but the `1, 2` arm appears as an empty `_begin` associated with `1`; the `g_case_12/u_c12` body only appears under the active `_gen_scope_array` when `MODE == 2`.

That points to a Surelog/UHDM construction or serialization issue for multi-label generate-case items, not a general inability to preserve inactive generate-case arm bodies.

## Useful Anchors

- `top_default_simple/folded.dump:767`: source `_gen_case` with all simple-label arm bodies.
- `top_default_implicit_simple/folded.dump:758`: implicit generate case with all simple-label arm bodies.
- `top_default_unnamed_simple/folded.dump:767`: unnamed arm bodies are preserved as `_begin` wrappers.
- `child_default_simple/folded.dump:685`: child default-parameter simple case with all arm bodies.
- `top_default_multi/folded.dump:739`: multi-label case source tree; `g_case_12` body is missing from `_gen_case`.
- `top_default_multi/folded.dump:992`: active selected `g_case_12/u_c12` appears as `_gen_scope_array`.
- `child_default_multi/folded.dump:657`: child multi-label case source tree; `g_case_12` body is missing from `_gen_case`.
- `child_default_multi/folded.dump:1269`: active selected `g_case_12/u_c12` appears as `_gen_scope_array`.
