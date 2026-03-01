# repo-tracer — Plan

> Make AI codebase navigation transparent and replayable.
> You see the answer. This shows the path.

---

## The Idea

When an AI answers "why are settlements delayed?" by reading 4 files across a codebase — you currently see the answer, not the reasoning chain. **repo-tracer** captures the exact path the AI took, maps it onto a live code graph, and lets you replay, diff, and share it.

Three layers:

```
Layer 1 — Code Graph     Parse any Go repo into a queryable property graph
Layer 2 — AI Tracer      Wrap every AI tool call, capture reason + symbols found
Layer 3 — UI             Timeline + animated graph showing the path taken
```

---

## Stack

| Layer | Tool | Why |
|---|---|---|
| Code parsing | `go/ast` + `golang.org/x/tools/go/callgraph` | Native Go toolchain — better than Joern for Go |
| Graph storage | **FalkorDB** | Built-in browser UI at `localhost:3000`, KuzuDB is archived |
| AI tracing | **Arize Phoenix** | OpenTelemetry-based, integrates with Claude/LangGraph |
| Graph viz | **Cytoscape.js** | Embeddable, flexible, well-documented |
| Traversal UI | Custom React | Full control over timeline + graph sync |
| Parser backend | Go | Same language as target repos |
| API / Tracer | Python (FastAPI) | Phoenix is Python-native, easier AI integration |
| Orchestration | Docker Compose | `docker compose up` — everything running in one command |

---

## Repo Structure

```
repo-tracer/
├── parser/              # Go: AST → graph extraction
│   ├── cmd/             # CLI: repo-tracer parse <repo-path>
│   ├── extractor/       # Walk packages, extract nodes + edges
│   └── graph/           # FalkorDB client + schema
├── tracer/              # Python: Claude wrapper + Phoenix
│   ├── claude_client.py # Wraps Anthropic SDK, intercepts tool calls
│   ├── phoenix_sink.py  # Sends trace events to Phoenix via OTEL
│   └── structured.py    # Structured output (reason, tool, args) before each action
├── api/                 # Python (FastAPI): serves trace + graph data
│   ├── routes/
│   │   ├── traces.py    # GET /traces, GET /traces/:id/steps
│   │   └── graph.py     # GET /graph/subgraph, GET /graph/node/:id
│   └── main.py
├── ui/                  # React frontend
│   ├── timeline/        # Step-by-step trace timeline component
│   ├── graph/           # Cytoscape.js canvas
│   └── diff/            # Run diff view (same query, two traces)
├── examples/            # Demo traces against real Go repos
├── docker-compose.yml
└── README.md
```

---

## Graph Schema

**Nodes**

| Label | Properties |
|---|---|
| `File` | path, package, line_count |
| `Package` | name, import_path |
| `Function` | name, file, line_start, line_end, signature |
| `Method` | name, receiver, file, line_start, line_end |
| `Struct` | name, file, line |
| `Interface` | name, file, line |

**Edges**

| Type | From → To | Meaning |
|---|---|---|
| `IMPORTS` | File → Package | this file imports that package |
| `CALLS` | Function → Function | direct call edge |
| `IMPLEMENTS` | Struct → Interface | struct satisfies interface |
| `DEFINED_IN` | Function → File | where the function lives |
| `BELONGS_TO` | File → Package | file is part of package |

---

## Trace Event Schema

Every AI tool call emits this before and after execution:

```json
{
  "session_id": "uuid",
  "step": 3,
  "tool": "read",
  "target": "internal/settlement/service.go",
  "reason": "SettlementCron imports this — likely where delay logic lives",
  "symbols_found": ["calculateSettlement", "holdAmount"],
  "next_decision": "holdAmount has a 2-day hardcode → likely root cause",
  "duration_ms": 142,
  "timestamp": "2026-03-01T10:23:11Z"
}
```

**Getting `reason` reliably:** Claude emits structured JSON before each tool call using `response_format`. This is the most reliable approach — no parsing, no inference.

---

## Phases

### Phase 1 — Code Graph Pipeline

**Goal:** Parse a Go repo into FalkorDB and run real queries.

- [ ] `parser/extractor`: walk all `.go` files with `go/ast`
- [ ] Extract function declarations, method receivers, struct/interface definitions
- [ ] Use `golang.org/x/tools/go/callgraph` (pointer analysis) for call edges
- [ ] Write graph to FalkorDB via Cypher
- [ ] CLI: `repo-tracer parse ./path/to/repo`
- [ ] Test query: `MATCH (a:Function)-[:CALLS]->(b:Function {name: "X"}) RETURN a`
- [ ] Validate on a real public Go repo

**Done when:** FalkorDB browser at `localhost:3000` shows a real Go repo as a navigable graph.

---

### Phase 2 — AI Traversal Tracer

**Goal:** Every Claude tool call emits a structured trace event with reasoning.

- [ ] Set up Arize Phoenix via Docker
- [ ] `claude_client.py`: wrap Anthropic SDK, intercept before/after each tool call
- [ ] Before action: prompt Claude for `{reason}` as structured output
- [ ] After action: extract `symbols_found` from tool result
- [ ] Emit full trace event to Phoenix via OpenTelemetry
- [ ] CLI: `repo-tracer trace "why are settlements delayed?" --repo ./path`
- [ ] Validate: run a real query, inspect full trace in Phoenix UI

**Done when:** Phoenix UI shows a full trace with a `reason` for every step.

---

### Phase 3 — Timeline UI

**Goal:** Clean web UI showing AI's step-by-step reasoning. No graph yet.

```
[QUERY] "Why are settlements delayed?"
  ├─ [1] glob: internal/settlement/**     "settlement is the domain"           ✓ 4 files
  ├─ [2] read: settlement_cron.go         "cron is the scheduled entry point"  ✓ holdAmount found
  ├─ [3] grep: "delay|hold" in cron       "looking for where delay introduced" ✓ line 47
  └─ [4] read: settlement_service.go:47   "holdAmount hardcoded 2 days → ROOT CAUSE"
```

- [ ] FastAPI: `GET /traces`, `GET /traces/:id/steps`
- [ ] React timeline component — steps in order, expandable cards
- [ ] Each card: tool, target, reason, symbols found, duration
- [ ] Root cause step highlighted
- [ ] Session selector — switch between past traces

**Done when:** Any past trace session can be browsed and replayed in the UI.

---

### Phase 4 — Graph + Trace Integration

**Goal:** Connect trace steps to FalkorDB nodes. The graph lights up as the AI navigates.

This is the key integration: mapping `settlement_service.go:47` → FalkorDB node ID.

- [ ] Resolver: file path + symbol name → FalkorDB node ID
- [ ] FastAPI: `GET /traces/:id/subgraph` → visited nodes + edges
- [ ] Cytoscape.js canvas loads full repo graph
- [ ] Trace playback: visited nodes animate in sequence
- [ ] Click a node → jump to that step in the timeline
- [ ] Sidebar: files visited, functions called, call depth

**Done when:** Side-by-side view — timeline left, animated graph right. Nodes light up as you step through.

---

### Phase 5 — Advanced Features

- [ ] **Run diff:** same query, two traces → highlight diverging paths
- [ ] **Branching paths:** rejected paths shown as dimmed ghost nodes
- [ ] **Query search:** find past sessions by keyword, file, or function name
- [ ] **Embed mode:** `<TraceViewer traceId="..." />` React component
- [ ] **Export:** download trace as JSON or shareable link
- [ ] **Stats:** avg steps to root cause, most visited files across sessions

---

## Running Locally

```bash
git clone https://github.com/arvind3417/repo-tracer
cd repo-tracer
docker compose up        # FalkorDB :3000, Phoenix :6006, API :8000, UI :5173

# Parse a Go repo into the graph
go run ./parser/cmd parse ./path/to/your/go/repo

# Ask a question and trace the AI's path
python tracer/cli.py trace "why are settlements delayed?" --repo ./path/to/repo
```

---

## Open Questions

- Which pointer analysis mode for callgraph? (`pta` is precise but slow on large repos — `rta` may be enough for MVP)
- Should the tracer support models other than Claude from day one, or Claude-only for MVP?
- Graphiti (23k stars, temporal graph for AI agents) could replace the custom tracer layer — worth evaluating after Phase 2

---

## References

- [FalkorDB](https://github.com/FalkorDB/FalkorDB) — graph DB with built-in browser
- [Arize Phoenix](https://github.com/Arize-ai/phoenix) — open source AI observability
- [Joern](https://github.com/joernio/joern) — code property graph (CPG) for multi-language
- [Graphiti](https://github.com/getzep/graphiti) — temporal knowledge graph for AI agents (23.2k stars)
- [golang.org/x/tools/go/callgraph](https://pkg.go.dev/golang.org/x/tools/go/callgraph) — Go call graph analysis
- [Cytoscape.js](https://cytoscape.org/) — graph visualization library
