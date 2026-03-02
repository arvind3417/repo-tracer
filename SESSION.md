# repo-tracer — Session Log

> Full record of what was built, decided, and discovered in the founding session of repo-tracer.

---

## Where It Started

The idea came from a note in a personal second brain (saved 2026-03-01):

> Build a repo knowledge graph + AI traversal tracer so a UI can show the exact path and reasoning the AI took through a codebase.

The core problem: when an AI answers "why are settlements delayed?" by navigating 4 files, you see the answer — not the reasoning chain. repo-tracer makes that chain visible, replayable, and shareable.

---

## Research: Open Source Landscape

Before building, we surveyed the ecosystem to find the right tools.

### Key finding: KuzuDB is archived

The original second brain note recommended KuzuDB as graph storage. During research we found it was **archived in October 2025** — the team is working on something new. This changed the storage recommendation.

### Updated tool landscape

| Layer | Tool chosen | Why | Stars |
|---|---|---|---|
| Code graph | `go/ast` + `golang.org/x/tools/go/callgraph` | Native Go toolchain, better than Joern for Go | — |
| Graph storage | **FalkorDB** | KuzuDB archived; FalkorDB has built-in browser UI at `:3000` | 3.6k |
| AI agent memory | **Graphiti** | 23.2k stars, temporal graph for AI agents, MCP-ready — wasn't in original note | 23.2k |
| AI tracing | **Arize Phoenix** | OpenTelemetry-based, integrates with Claude/LangGraph | 8.7k |
| Graph viz | **Cytoscape.js** | Embeddable, flexible | — |
| Traversal path UI | **LangGraph Studio** (reference) | Shows which nodes/paths were hit — inspiration for our custom UI | 25.3k |

### Microsoft GraphRAG (31.2k stars)
Good for document/text RAG but not code-specific. Not chosen.

### Memgraph
Has **Memgraph Lab** (visual UI), real-time streaming. Good alternative to FalkorDB if needed.

---

## Architecture: Three Layers

```
Layer 1 — Code Graph     Parse any Go repo into a queryable property graph (FalkorDB)
Layer 2 — AI Tracer      Wrap every Claude tool call, capture reason + symbols found
Layer 3 — UI             Timeline + animated graph showing the path taken
```

### Cross-repo design (added after initial planning)

Real-world queries span multiple repos. Chi might call into another service. Three cross-repo edge types:

| Edge | Detected by | Confidence |
|---|---|---|
| `DEPENDS_ON` (Repo→Repo) | `go.mod` direct dependencies | High |
| `CALLS_SERVICE` (Function→GRPCService) | `pb.NewXxxClient(conn)` AST pattern | Medium |
| `PRODUCES_EVENT` / `CONSUMES_EVENT` | Kafka topic string constants | Medium |

**Key design decision:** Cross-repo edges are "fuzzy" — inferred from patterns, not type-checked. Stored with a `confidence` property. Rendered differently in the UI (dashed, different colour).

**Ghost nodes:** When a trace step crosses a repo boundary that isn't in the workspace, it shows as a dashed "ghost" node with a prompt to add that repo.

---

## Implementation: 6 Phases + Branches

Each phase got its own GitHub branch, built by a dedicated sub-agent in parallel where dependencies allowed.

### Phase 1 — Code Graph Pipeline (`phase-1-code-graph`)

**What:** Parse any Go repo into FalkorDB using native Go toolchain.

- `parser/extractor/extractor.go` — `go/ast` walker: File, Package, Function, Method, Struct, Interface nodes + IMPORTS, DEFINED_IN, BELONGS_TO edges
- `parser/extractor/callgraph.go` — RTA callgraph via `golang.org/x/tools`: CALLS + IMPLEMENTS edges
- `parser/graph/schema.go` — All node/edge types with `repo` and `workspace` properties for multi-repo namespacing
- `parser/graph/client.go` — FalkorDB client via Redis protocol; batch writes in chunks of 500
- `parser/cmd/main.go` — CLI: `repo-tracer parse <path> [--workspace] [--falkordb]`
- `Makefile`, `docker-compose.yml` (FalkorDB only)

**Build:** `go build ./...` — clean ✅

### Phase 2 — AI Traversal Tracer (`phase-2-ai-tracer`)

**What:** Wrap Claude API to intercept every tool call and emit structured trace events.

**Key design:** Before each tool call, a fast Haiku call produces structured JSON `{reason, expected_symbols}`. This is the "structured output before action" pattern — most reliable way to capture reasoning without parsing free-form text.

- `tracer/claude_client.py` — Wraps Anthropic SDK; intercepts tool calls; gets pre-action reason via Haiku
- `tracer/phoenix_sink.py` — Emits trace events to Arize Phoenix via OpenTelemetry
- `tracer/models.py` — `TraceStep`, `TraceSession`, `PreActionReason` Pydantic models
- `tracer/cli.py` — CLI: `python -m tracer.cli trace "query" --repo ./path`
- `docker-compose.yml` — FalkorDB + Phoenix (`arizephoenix/phoenix:latest`)

**Trace event schema:**
```json
{
  "session_id": "uuid",
  "step": 3,
  "tool": "read_file",
  "target": "internal/settlement/service.go",
  "reason": "SettlementCron imports this — likely where delay logic lives",
  "symbols_found": ["calculateSettlement", "holdAmount"],
  "duration_ms": 142,
  "is_root_cause": false
}
```

**Build:** Import check passed ✅

### Phase 3 — Timeline UI (`phase-3-timeline-ui`)

**What:** FastAPI backend + React frontend with dark developer-themed timeline.

- `api/main.py` — FastAPI with CORS for `localhost:5173`
- `api/routes/traces.py` — `GET /api/traces`, `GET /api/traces/:id`, `GET /api/traces/:id/steps`, `POST /api/traces/mock`
- `ui/src/components/Timeline.tsx` — Step-by-step timeline, 150ms stagger animation per step
- `ui/src/components/StepCard.tsx` — Tool badge (glob=blue, read=green, grep=yellow), expand/collapse, root cause highlight
- `ui/src/components/SessionList.tsx` — Session list with time-ago, step count, repo badge

**Design aesthetic:** Dark theme (`#0d1117` background), JetBrains Mono, developer-focused — like a terminal crossed with a debugger.

**Build:** `npm run build` — 202KB bundle ✅, FastAPI health check ✅

### Phase 3.5 — Multi-Repo Support (`phase-3.5-multi-repo`)

**What:** Extend Phase 1 parser to handle multiple repos in a shared FalkorDB workspace.

- `parser/extractor/gomod.go` — `ParseGoMod()`: reads `go.mod`, emits `DEPENDS_ON` edges between Repo nodes
- `parser/extractor/grpc.go` — `DetectGRPCCalls()`: scans for `pb.NewXxxClient(conn)` patterns, emits `CALLS_SERVICE` edges
- `parser/extractor/kafka.go` — `DetectKafkaTopics()`: scans for Publish/Subscribe string literals, emits `PRODUCES_EVENT`/`CONSUMES_EVENT` edges + matches producers to consumers across repos
- `parser/extractor/workspace.go` — `ParseWorkspace()`: two-pass orchestrator (read all go.mod → parse all repos)
- CLI extended: `repo-tracer parse ./api ./payments-service --workspace razorpay`

**Build:** `go build ./...` — clean ✅

### Phase 4 — Graph + Trace Integration (`phase-4-graph-integration`)

**What:** Connect trace steps to FalkorDB graph nodes. The key integration gap: `settlement_service.go:47` → FalkorDB node ID.

- `api/resolver.py` — `NodeResolver`: maps trace step targets to FalkorDB node IDs. Resolution order:
  1. `read_file` with `:LINE` → exact Function/Method at that line (±5 tolerance)
  2. `read_file` (no line) → File node by path
  3. `glob_files` → File nodes matching pattern (prefer non-test files)
  4. `grep_files` → parse `symbols_found` for file:line hints
  5. Unresolved → `GhostNode`
- `api/falkordb_client.py` — FalkorDB Redis-protocol client with lazy connection, graceful offline handling
- `api/routes/graph.py` — `GET /api/graph/workspaces`, `/nodes`, `/edges`, `/subgraph?session_id=X`, `/node/:id`
- `ui/src/components/GraphCanvas.tsx` — Cytoscape.js canvas; repo clusters as compound nodes; visited nodes glow amber; `activeStep` pans camera
- `ui/src/components/SplitView.tsx` — Three-panel layout: SessionList | Timeline | GraphCanvas; `activeStep` state links both panels

**Build:** Python import check ✅, `npm run build` ✅

### Phase 5 — Advanced Features (`phase-5-advanced`)

**What:** Run diff, session search, export, stats panel, deep links.

- `api/routes/diff.py` — `GET /api/diff?session_a=&session_b=&workspace=`: resolves both sessions, computes shared/only-A/only-B node sets, finds divergence step
- `api/routes/search.py` — `GET /api/search?q=`: case-insensitive search across query, target, symbols_found, reason fields
- `api/routes/export.py` — JSON download, Markdown render, permalink URL
- `api/routes/stats.py` — `GET /api/stats`: avg steps, most visited files, tool usage breakdown
- `ui/src/components/DiffView.tsx` — Side-by-side diff: shared=grey, only-A=blue, only-B=orange, divergence=amber border
- `ui/src/components/SearchBar.tsx` — 300ms debounce, dropdown results
- `ui/src/components/ExportButton.tsx` — JSON/Markdown download, permalink copy with "Copied!" toast
- `ui/src/components/StatsPanel.tsx` — Collapsible, pure-CSS bar chart for top files
- Deep links: `?session=<id>&workspace=<name>` auto-selects on load

**Build:** Python import check ✅, `npm run build` ✅

---

## The `experimental` Branch

All 6 phases merged into a single `experimental` branch for testing:

```bash
git clone https://github.com/arvind3417/repo-tracer
cd repo-tracer
git checkout experimental
```

Merge conflicts were all in `docker-compose.yml` and `Makefile` (each phase added its own services). Resolved by hand to produce a final `docker-compose.yml` with all services:

- `falkordb` — Graph DB + browser UI at `:3000`
- `phoenix` — AI trace UI at `:6006` (OTLP at `:4317`/`:4318`)
- `api` — FastAPI at `:8000`

6 PRs opened on GitHub: https://github.com/arvind3417/repo-tracer/pulls

---

## Phase 1 Validation: chi Router

Validated against **go-chi/chi** (74 `.go` files, well-known Go HTTP router).

```bash
# FalkorDB running via Docker (Colima)
go run ./parser/cmd parse --workspace validation --falkordb localhost:6379 /path/to/chi
```

**Results:**
```
Extracting nodes...   538 nodes, 731 edges (AST)
Analysing call graph...  112,681 additional call/implements edges
Done. 538 nodes, 113,412 edges in 45.8s
```

**Validation queries run in FalkorDB browser:**

```cypher
-- Function call edges
MATCH (f:Function)-[:CALLS]->(g:Function) RETURN f.name, g.name LIMIT 10

-- Interface implementations
MATCH (s:Struct)-[:IMPLEMENTS]->(i:Interface) RETURN s.name, i.name
-- Result: Mux→Router, Mux→Routes, defaultLogEntry→LogFormatter, etc.

-- Node type breakdown
MATCH (n) RETURN labels(n)[0] as type, count(n) as cnt ORDER BY cnt DESC
-- Function: 225, Method: 127, File: 74, Package: 64, Struct: 39, Interface: 8
```

All queries correct ✅

---

## Vertex AI Integration

Claude Code runs via Google Vertex AI (`CLAUDE_CODE_USE_VERTEX=1`), not the direct Anthropic API. The tracer was patched to support both:

```python
def _make_client():
    if os.environ.get("CLAUDE_CODE_USE_VERTEX") == "1":
        from anthropic import AnthropicVertex
        return AnthropicVertex(project_id=PROJECT, region=REGION)
    return anthropic.Anthropic(api_key=API_KEY)

_MODEL_SONNET = "claude-sonnet-4-5" if _IS_VERTEX else "claude-sonnet-4-6"
_MODEL_HAIKU  = "claude-haiku-4-5"  if _IS_VERTEX else "claude-haiku-4-5-20251001"
```

**Bug found during Vertex integration:** Haiku on Vertex wraps JSON responses in markdown code fences (` ```json ... ``` `). Fixed by stripping fences before `json.loads()`.

---

## Claude Code Hook

Built a `PostToolUse` hook that captures every Read/Glob/Grep tool call Claude Code makes in real-time:

**File:** `~/.claude/hooks/repo-tracer-hook.py`

**How it works:**
1. Claude Code fires the hook after every `Read`, `Glob`, or `Grep` tool call
2. Hook receives the tool name, input, response, and session ID as JSON on stdin
3. Extracts target path, infers a reason from the tool input, extracts Go symbol names from the response
4. Writes/updates a trace session JSON at `./traces/cc-<session_id>.json`
5. FastAPI picks up the file automatically — session appears in UI on next refresh

**Registered in `~/.claude/settings.json`:**
```json
{
  "matcher": "Read|Glob|Grep",
  "hooks": [{
    "command": "~/.claude/hooks/venv/bin/python3 ~/.claude/hooks/repo-tracer-hook.py",
    "type": "command",
    "timeout": 10000
  }]
}
```

**Dedicated venv** at `~/.claude/hooks/venv/` — separate from the project venv so it's always available regardless of working directory.

**Key issue resolved:** The initial hook tried to call Vertex AI for each reason, which hung indefinitely (no timeout, no async). Replaced with a fast heuristic:
- `Read file.go` → "Reading file.go to understand its implementation"
- `Glob **/*.go` → "Finding files matching **/*.go"
- `Grep pattern in dir` → "Searching for 'pattern' in dir"

---

## Bugs Found and Fixed

### 1. go flag package stops at first positional arg

**Symptom:** `go run ./parser/cmd parse /path/to/repo --workspace validation` failed with "repo path does not exist: --workspace".

**Cause:** Go's `flag` package stops parsing at the first non-flag argument. Flags must come before positional args.

**Fix:** Document that flags go first: `repo-tracer parse --workspace validation ./path`

### 2. KuzuDB archived — not mentioned in second brain note

**Discovery:** KuzuDB was archived October 2025. The second brain note recommended it.

**Fix:** Switched to FalkorDB (has built-in browser UI, actively maintained). Updated the second brain note.

### 3. FalkorDB compact format type codes wrong

**Symptom:** `api/falkordb_client.py` returned `{}` for all node properties from `MATCH (n) RETURN n` queries.

**Root cause:** The client used wrong compact format type codes (had `type 3 = string` but FalkorDB uses `type 2 = string`). Also, returning whole node objects requires schema lookups to resolve property key IDs.

**Fix:** Dropped `--compact` flag entirely. Switched to non-compact mode which returns plain Python scalars. Also changed `_fetch_all_nodes()` to use explicit property projections (`RETURN id(n) AS _id, n.path AS path, n.name AS name ...`) instead of returning whole node objects.

### 4. Timeline steps invisible (opacity: 0 bug)

**Symptom:** Timeline showed session header but no steps visible. Steps were in the DOM but `getComputedStyle(el).opacity === "0"`.

**Root cause:** `Timeline.module.css` had `.stepWrapper { opacity: 0; animation: fadeInUp ... }` where `fadeInUp` was defined in `globals.css`. CSS Modules + global keyframe reference didn't work — keyframe didn't run, elements stayed at `opacity: 0`.

**Fix:** Inlined `@keyframes fadeInUp` directly in `Timeline.module.css` and changed `animation` fill mode to `both` (handles both pre and post animation states).

### 5. FalkorDB flag parsing — `parse` subcommand arg order

**Symptom:** `go run ./parser/cmd parse /path --workspace X` treated `--workspace` as another repo path.

**Root cause:** Standard `flag.FlagSet` stops parsing at first non-flag argument. Everything after becomes `fs.Args()`.

**Fix:** Flags before positional args: `go run ./parser/cmd parse --workspace X /path`

### 6. API loses TRACES_DIR env var on restart

**Symptom:** After restarting uvicorn, `GET /api/traces` returned `[]` even though trace files existed.

**Root cause:** `TRACES_DIR` env var wasn't passed to the new uvicorn process when using `--app-dir`.

**Fix:** Always start API with explicit env: `TRACES_DIR=/path/to/traces uvicorn api.main:app ...`

---

## Live Demo Results

### Trace 1: "how does chi handle middleware chaining?"

Ran via tracer CLI with Vertex AI:

```
Steps: 7
[1] glob_files   **/*.go          "Finding all Go source files"
[2] read_file    chain.go         "Examining chain.go for middleware mechanism"
[3] read_file    chi.go           "Understanding the Router interface"
[4] read_file    mux.go           "Examining mux implementation"
[5] read_file    middleware/middleware.go
[6] grep_files   (search)
[7] read_file    mux_test.go
```

### Trace 2: "how does chi route requests to handlers?"

```
Steps: 5
[1] glob_files   **/*.go
[2] read_file    mux.go           "Examining main mux for request dispatch"
[3] read_file    tree.go          "Understanding radix tree route matching"
[4] read_file    chi.go           "Understanding chi Router implementation"
[5] read_file    context.go       "Understanding routing context"
```

### Live Claude Code hook (current session)

Answering "how does chi handle 404s?" triggered automatic capture of:
```
[13] glob_files   *.go
[14] grep_files   NotFound|404 in mux.go
[15] read_file    mux.go (line 55-74)
[16] read_file    mux.go (line 195-233)
[17] read_file    mux.go (line 470-485)
[18] read_file    supress_notfound.go
```

7 graph nodes resolved: `tree.go`, `mux.go` (×4), `supress_notfound.go` — all lit up amber in the graph.

---

## Running the Full Stack

```bash
# Prerequisites: Colima running (Docker)
colima start

git clone https://github.com/arvind3417/repo-tracer
cd repo-tracer
git checkout experimental

# Start FalkorDB + Phoenix
docker compose up -d falkordb phoenix

# Parse a Go repo into the graph
go run ./parser/cmd parse --workspace myproject ./path/to/go/repo

# Install Python deps
python3 -m venv .venv && .venv/bin/pip install -r tracer/requirements.txt -r api/requirements.txt

# Start API
TRACES_DIR=./traces .venv/bin/uvicorn api.main:app --port 8000

# Start UI
cd ui && npm install && npm run dev

# Trace a question (Vertex AI)
CLAUDE_CODE_USE_VERTEX=1 ANTHROPIC_VERTEX_PROJECT_ID=your-project \
  .venv/bin/python -m tracer.cli trace "your question" --repo ./path/to/repo
```

**Services:**
| Service | URL |
|---|---|
| React UI | http://localhost:5173 |
| FastAPI | http://localhost:8000 |
| FalkorDB browser | http://localhost:3000 |
| Phoenix trace UI | http://localhost:6006 |

**Using the UI:**
1. Select workspace from top-right dropdown
2. Click a session from the left panel
3. Timeline shows in the center with step-by-step reasoning
4. Graph on the right highlights visited nodes in amber
5. Click a step → camera pans to that node in the graph
6. Click a node → timeline jumps to that step

---

## What's Live on GitHub

| Branch | What's in it |
|---|---|
| `main` | `PLAN.md` only |
| `phase-1-code-graph` | Go parser, FalkorDB client, parse CLI |
| `phase-2-ai-tracer` | Claude wrapper, Phoenix sink, trace CLI |
| `phase-3-timeline-ui` | FastAPI + React timeline |
| `phase-3.5-multi-repo` | go.mod, gRPC, Kafka cross-repo detection |
| `phase-4-graph-integration` | Resolver, Cytoscape.js canvas, 3-panel UI |
| `phase-5-advanced` | Diff, search, export, stats |
| `experimental` | All phases merged — **use this for testing** |

PRs: https://github.com/arvind3417/repo-tracer/pulls (6 open, merge in order 1→2→3→3.5→4→5)

---

## Open Questions / Next Steps

1. **Reason quality** — hook currently uses heuristic reasons ("Reading X to understand its implementation"). Could add async Vertex AI call with a timeout for richer reasoning.

2. **Non-.go files in graph** — `README.md`, Python files etc. are captured in traces but have no graph nodes (graph only has `.go` files). Could add a documentation layer or just filter them out of trace display.

3. **FalkorDB `--compact` format** — dropped in favour of non-compact. Should revisit once FalkorDB Python SDK is more stable.

4. **Graphiti integration** — 23.2k stars, temporal knowledge graph for AI agents. Could replace the custom tracer layer. Worth evaluating as an alternative to the Phoenix-based approach.

5. **Multi-repo validation** — Phase 3.5 built but not validated end-to-end with two real repos. Need to test go.mod → DEPENDS_ON edge detection with a real multi-repo workspace.

6. **Graph node labels showing filename** — currently truncated to full path in the UI. Should show just the filename with repo as a tooltip.
