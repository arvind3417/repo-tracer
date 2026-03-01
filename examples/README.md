# repo-tracer — Quick Start

## Prerequisites

- Docker and Docker Compose
- Go 1.21+

## Start FalkorDB

```bash
make docker-up
```

This starts FalkorDB on:
- `localhost:6379` — Redis-compatible query port
- `localhost:3000` — Browser UI

## Parse a Go repository

```bash
make parse REPO=./path/to/go/repo
```

With optional flags:

```bash
go run ./parser/cmd parse ./path/to/go/repo \
  --workspace myproject \
  --graph myproject \
  --falkordb localhost:6379
```

## Open the browser UI

```bash
open http://localhost:3000
```

Select your graph name (e.g. `default`) in the dropdown.

## Example Cypher queries

Paste these into the FalkorDB browser query bar:

```cypher
# Show all function call relationships
MATCH (f:Function)-[:CALLS]->(g:Function) RETURN f.name, g.name LIMIT 20
```

```cypher
# Show which files belong to which packages
MATCH (f:File)-[:BELONGS_TO]->(p:Package) RETURN f.path, p.name LIMIT 20
```

```cypher
# Show struct → interface implementations
MATCH (s:Struct)-[:IMPLEMENTS]->(i:Interface) RETURN s.name, i.name
```

```cypher
# Show all imports for a specific file
MATCH (f:File {path: 'main.go'})-[:IMPORTS]->(p:Package) RETURN p.import_path
```

```cypher
# Find the largest files by line count
MATCH (f:File) RETURN f.path, f.line_count ORDER BY f.line_count DESC LIMIT 10
```

```cypher
# Find all methods on a specific struct
MATCH (m:Method {receiver_type: '*MyStruct'}) RETURN m.name, m.signature
```

## Stop FalkorDB

```bash
make docker-down
```
