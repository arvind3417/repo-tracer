# Team Execution Plan

Goal: build full "codebase as city/building/flat/door" experience with reliable AI path replay.

## Squad A — Parser & Graph Integrity
- Owner: Graph Parser
- Scope:
  - Stable IDs (`function_key`, `method_key`)
  - Nested function extraction + `CONTAINS` edges
  - Ingest reliability and edge completeness checks
- Status:
  - In progress
  - `function_key`, `method_key`, nested extraction shipped

## Squad B — Resolver Accuracy
- Owner: Trace Resolver
- Scope:
  - Resolve nested functions with line-range priority
  - Parent-function-aware matching (`parent_function_key`)
  - Confidence tagging for fuzzy vs exact
- Status:
  - In progress
  - Nested-preferred ranking shipped

## Squad C — UX & Visualization
- Owner: Frontend Graph
- Scope:
  - `Path + Neighbors` mode for guaranteed visibility
  - Full graph mode for exploration
  - Trace-path overlay animation
- Status:
  - In progress
  - Mode toggle (`Path + Neighbors` / `Full Graph`) shipped

## Squad D — Cinematic Prototype
- Owner: Experience Team
- Scope:
  - 3D planet/city proof-of-concept
  - first-person path flythrough
  - timeline scrub/replay
- Status:
  - Pending (starts after stable 2D correctness gates)

## Milestone Gates
1. Data Correctness Gate
   - Non-zero nodes/edges
   - Nested nodes present
   - Path resolves >80% steps to node IDs
2. 2D UX Gate
   - Path visible in `Path + Neighbors` mode for large repos
   - No blank canvas failures
3. Cinematic Gate
   - 3D prototype renders from same session payloads
