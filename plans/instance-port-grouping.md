# C++-Backed Instance Port Grouping

## Summary

Add v1 grouping for `instance` nodes only. The C++ UHDM backend infers groups from blank-line gaps in the instantiated module's port declaration and serializes `groupIndex` metadata. TypeScript only consumes that metadata for sizing, layout, routing, and rendering. Boundary port nodes stay unchanged. No settings for v1.

## Public Interfaces

- Extend backend IR structs in `extractor.hpp`:
  - `Port::groupIndex`, defaulting to `-1`
  - `NodePort::groupIndex`, defaulting to `-1`
- Serialize `groupIndex` only when `>= 0` for module ports and node ports.
- Extend `DiagramPort` with optional `groupIndex?: number`.
- Do not change port ids, edge ids, or saved layout schema.

## Implementation Changes

- Add backend source analysis:
  - Implement `assignPortGroupsFromSource(Module& mod)` using existing C++ source-file helpers.
  - Sort `mod.ports` by source line/column while preserving declaration order for ties.
  - Start a new group when at least one empty or whitespace-only line exists between consecutive port source ranges.
  - Annotate ports only when two or more groups are detected.
  - Run this after module ports/source enrichment and before instance ports are finalized.
- Propagate grouping in C++:
  - When processing a module instance, look up the processed target module by `instanceOf`.
  - Copy matching declaration port `groupIndex` onto each instance `NodePort` by port name.
  - Keep TypeScript source handling out of the grouping inference path; `uhdmExtractor.ts` only parses the serialized field.
- Add a shared instance-port row allocator in TypeScript:
  - Without groups, preserve current row behavior.
  - With groups, each group reserves `max(inputCount, outputCount)` rows.
  - Add one empty grid row between groups.
  - Treat `input`, `inout`, and `unknown` as left-side rows; `output` as right-side rows.
- Use the allocator consistently in:
  - `diagramNodeDimensions`
  - ELK port coordinates and rendered lead offsets
  - React instance rendering

## Test Plan

- Backend/unit test: parse a child module with blank-line-separated declaration groups and a parent instance; assert backend-derived `groupIndex` appears on child ports and instance node ports.
- Sizing/unit test: grouped instance height includes the expected inter-group row; ungrouped instance dimensions stay unchanged.
- Layout/unit test: routes into grouped instance ports land on grouped row centers, including a mixed input/output group.
- Visual test: add a grouped-instance fixture and screenshot the instance to verify whitespace-only grouping.
- Run `npm run lint`, `npm run test`, and the targeted Playwright visual test.

## Assumptions

- A group break is at least one empty or whitespace-only source line between consecutive port declarations.
- Only C++ backend source analysis creates grouping metadata; TypeScript never infers groups from source text.
- Instance connection-list formatting and boundary port columns are out of scope for v1.
