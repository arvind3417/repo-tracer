# Edge Cases Build Checklist

This checklist tracks edge cases for the "codebase as city/building/flat/door" model.

## Status legend
- `[x]` implemented
- `[ ]` pending
- `[~]` partial

## Identity and nesting
- `[x]` Stable function identity: add `function_key` (`file:name:line:col`) on Function nodes.
- `[x]` Stable method identity: add `method_key` (`file:recv.name:line:col`) on Method nodes.
- `[x]` Nested/local function extraction: parse `FuncLit` and emit nested Function nodes.
- `[x]` Parent linkage: add `parent_function_key` and `CONTAINS` edges from parent to nested function.
- `[ ]` Multiple nested funcs on same line: include AST offset hash if needed.

## Cross-file and dynamic calls
- `[~]` Cross-file calls: represented via existing edges; stronger binding by keys still pending in callgraph writer.
- `[ ]` Interface/dynamic dispatch labeling: mark edges with `confidence=dynamic` where target is unresolved.
- `[ ]` Generic instantiation normalization (`T.F` / `*T.F` / instantiated symbols).

## Parse context correctness
- `[ ]` Build tags support (`GOOS/GOARCH/tags`) pinned at parse time.
- `[ ]` Generated-code filtering (`*.pb.go`, mocks) as configurable include/exclude.
- `[ ]` Vendor/test filtering as configurable CLI flags (currently hard-coded behavior).

## Ingestion integrity
- `[~]` Write timeout hardening: increased Redis timeouts + smaller batches.
- `[ ]` Checkpointed ingest with resumable batches.
- `[ ]` Post-ingest integrity check (`node_count`, `edge_count`, non-zero relation sanity).

## Resolver and UI mapping
- `[x]` Resolver key alignment (`_id`, `line_start`, `line_end`) fixed.
- `[x]` Edge decode fix for Falkor tuple format.
- `[ ]` Nested-function-aware resolution priority (`parent_function_key` + line/col match).
- `[ ]` Explicit path edge construction for non-adjacent graph nodes in subgraph API.

## Rendering and UX
- `[x]` Large graph layout fallback to avoid blank canvas.
- `[x]` Render status + fallback visualization when graph engine load fails.
- `[ ]` Mode toggle: `Full Graph` vs `Session Path + Neighbors`.
- `[ ]` Performance budget guardrails (node/edge caps + progressive loading).

## Tests to add
- `[ ]` Unit: nested closure extraction with deterministic keys.
- `[ ]` Unit: duplicate names across files/packages do not collide.
- `[ ]` Integration: ingest completes with non-zero edges on large repo.
- `[ ]` E2E: session replay highlights nested + cross-file traversal.
