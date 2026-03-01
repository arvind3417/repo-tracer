# Multi-Repo Workspace Example

## Parse two related repos

```bash
make docker-up

go run ./parser/cmd \
  ./path/to/api \
  ./path/to/payments-service \
  --workspace razorpay

# or with make:
make parse-workspace REPOS="./api ./payments-service" WORKSPACE=razorpay
```

## Cypher queries for cross-repo exploration

```cypher
# Which repos depend on which?
MATCH (a:Repo)-[:DEPENDS_ON]->(b:Repo) RETURN a.name, b.name

# Which functions call gRPC services?
MATCH (f:Function)-[:CALLS_SERVICE]->(s:GRPCService) RETURN f.name, f.repo, s.name

# Full Kafka event flow across repos
MATCH (f:Function)-[:PRODUCES_EVENT]->(t:KafkaTopic)<-[:CONSUMES_EVENT]-(g:Function)
RETURN f.name, f.repo, t.name, g.name, g.repo

# Cross-repo call chain
MATCH path = (a:Function {repo: "api"})-[:CALLS_SERVICE|PRODUCES_EVENT*1..3]->(b)
RETURN path LIMIT 10
```
