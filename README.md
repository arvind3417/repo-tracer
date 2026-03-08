# repo-tracer

> Make AI codebase navigation transparent and replayable.

repo-tracer captures every tool call Claude makes when exploring a Go repository, records the structured reasoning behind each step, and emits the full trace to an OpenTelemetry sink ([Arize Phoenix](https://phoenix.arize.com/) or Langfuse).

## Architecture

```
Layer 1 — Code Graph     Parse any Go repo into a queryable property graph (FalkorDB)
Layer 2 — AI Tracer      Wrap every Claude tool call, capture reason + symbols found
Layer 3 — UI             Timeline + animated graph showing the path taken
```

## Quick Start

```bash
# 1. Start services
docker compose up -d

# 2. Install Python deps
pip install -r tracer/requirements.txt

# 3. Set your API key
cp .env.example .env && echo "ANTHROPIC_API_KEY=sk-..." >> .env

# 4. Trace a question against a Go repo
python -m tracer.cli trace "why does X happen?" --repo ./path/to/go/repo

# 5. View trace in Phoenix
open http://localhost:6006
```

## Services

| Service | Port | URL |
|---------|------|-----|
| Phoenix UI | 6006 | http://localhost:6006 |
| Phoenix OTLP gRPC | 4317 | — |
| Phoenix OTLP HTTP | 4318 | — |
| FalkorDB (Redis API) | 6379 | — |
| FalkorDB Browser UI | 3000 | http://localhost:3000 |

## CLI Usage

```
python -m tracer.cli trace "<question>" --repo <path-to-go-repo> [--phoenix <otlp-endpoint>]
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--repo` | (required) | Path to the Go repository to analyse |
| `--phoenix` | `http://localhost:4318/v1/traces` | OTLP HTTP endpoint |
| `--sink` | `phoenix` | Sink backend: `phoenix` or `langfuse` |
| `--langfuse-host` | `https://cloud.langfuse.com` | Langfuse host when `--sink langfuse` |

Each run saves a JSON session file to `./traces/<session-id>.json`.

### Langfuse Setup

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_HOST=https://cloud.langfuse.com

python -m tracer.cli trace "why does X happen?" \
  --repo ./path/to/go/repo \
  --sink langfuse
```

## Trace Events

Every tool call produces a `TraceStep` with:

- `session_id` — UUID linking all steps in a run
- `step` — sequential step number
- `tool` — `read_file`, `glob_files`, or `grep_files`
- `target` — the file path or pattern passed to the tool
- `reason` — structured pre-action reasoning from Claude
- `symbols_found` — Go functions / types extracted from the result
- `duration_ms` — wall-clock time for the tool call
- `is_root_cause` — flag for root-cause steps (set by post-processing)

## Package Layout

```
tracer/
  __init__.py          — public exports
  __main__.py          — python -m tracer entry point
  cli.py               — CLI command definitions
  claude_client.py     — TracedClaudeClient wrapping Anthropic SDK
  phoenix_sink.py      — PhoenixSink + setup_phoenix() for OTEL export
  models.py            — Pydantic models (TraceStep, TraceSession, PreActionReason)
  requirements.txt     — Python dependencies
docker-compose.yml     — FalkorDB + Phoenix services
.env.example           — Environment variable template
traces/                — JSON session files written at runtime
```
