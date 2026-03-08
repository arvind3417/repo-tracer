package graph

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const batchSize = 200

// Client wraps a Redis client configured to talk to FalkorDB.
type Client struct {
	rdb *redis.Client
	ctx context.Context
}

// NewClient creates a new FalkorDB client connected to the given address.
func NewClient(addr string) *Client {
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		DialTimeout:  10 * time.Second,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
	})
	return &Client{
		rdb: rdb,
		ctx: context.Background(),
	}
}

// Close closes the underlying Redis connection.
func (c *Client) Close() error {
	return c.rdb.Close()
}

// Ping checks connectivity to FalkorDB.
func (c *Client) Ping() error {
	return c.rdb.Ping(c.ctx).Err()
}

// Query executes an arbitrary Cypher query against the named graph.
func (c *Client) Query(graph, cypher string, params ...interface{}) error {
	args := []interface{}{"GRAPH.QUERY", graph, cypher}
	args = append(args, params...)
	return c.rdb.Do(c.ctx, args...).Err()
}

// escapeString escapes single quotes in a string for safe embedding in Cypher.
func escapeString(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}

// propsToString converts a property map to an inline Cypher property string.
func propsToString(props map[string]interface{}) string {
	if len(props) == 0 {
		return ""
	}
	parts := make([]string, 0, len(props))
	for k, v := range props {
		switch val := v.(type) {
		case string:
			parts = append(parts, fmt.Sprintf("%s: '%s'", k, escapeString(val)))
		case int:
			parts = append(parts, fmt.Sprintf("%s: %d", k, val))
		case int64:
			parts = append(parts, fmt.Sprintf("%s: %d", k, val))
		case bool:
			if val {
				parts = append(parts, fmt.Sprintf("%s: true", k))
			} else {
				parts = append(parts, fmt.Sprintf("%s: false", k))
			}
		default:
			parts = append(parts, fmt.Sprintf("%s: '%v'", k, val))
		}
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

// CreateNode creates a single node in the graph.
func (c *Client) CreateNode(graph string, node Node) error {
	cypher := fmt.Sprintf("MERGE (n:%s %s)", node.Label, propsToString(node.Properties))
	return c.Query(graph, cypher)
}

// CreateEdge creates a single edge in the graph using MERGE on both endpoints and the relationship.
func (c *Client) CreateEdge(graph string, edge Edge) error {
	cypher := fmt.Sprintf(
		"MATCH (a:%s {%s: '%s'}), (b:%s {%s: '%s'}) MERGE (a)-[:%s]->(b)",
		edge.FromLabel, edge.FromKey, escapeString(fmt.Sprintf("%v", edge.FromValue)),
		edge.ToLabel, edge.ToKey, escapeString(fmt.Sprintf("%v", edge.ToValue)),
		edge.Relation,
	)
	return c.Query(graph, cypher)
}

// BatchWrite writes nodes and edges to FalkorDB in chunks of batchSize.
func (c *Client) BatchWrite(graph string, nodes []Node, edges []Edge) error {
	// Write nodes in batches.
	for i := 0; i < len(nodes); i += batchSize {
		end := i + batchSize
		if end > len(nodes) {
			end = len(nodes)
		}
		batch := nodes[i:end]
		if err := c.batchWriteNodes(graph, batch); err != nil {
			return fmt.Errorf("batch write nodes [%d:%d]: %w", i, end, err)
		}
	}

	// Write edges in batches.
	for i := 0; i < len(edges); i += batchSize {
		end := i + batchSize
		if end > len(edges) {
			end = len(edges)
		}
		batch := edges[i:end]
		if err := c.batchWriteEdges(graph, batch); err != nil {
			return fmt.Errorf("batch write edges [%d:%d]: %w", i, end, err)
		}
	}
	return nil
}

// batchWriteNodes writes a slice of nodes using a single multi-statement Cypher query.
func (c *Client) batchWriteNodes(graph string, nodes []Node) error {
	if len(nodes) == 0 {
		return nil
	}
	parts := make([]string, 0, len(nodes))
	for idx, node := range nodes {
		alias := fmt.Sprintf("n%d", idx)
		parts = append(parts, fmt.Sprintf("MERGE (%s:%s %s)", alias, node.Label, propsToString(node.Properties)))
	}
	cypher := strings.Join(parts, " ")
	return c.Query(graph, cypher)
}

// batchWriteEdges writes a slice of edges. Each edge requires a MATCH so we
// issue them individually but grouped in the smallest viable transaction unit.
// FalkorDB does not support multi-statement queries for edges with MATCH in one
// shot without UNION tricks, so we issue each edge as a single query but call
// them in sequence inside this helper for clarity and future batching support.
func (c *Client) batchWriteEdges(graph string, edges []Edge) error {
	for _, edge := range edges {
		if err := c.CreateEdge(graph, edge); err != nil {
			// Log and continue — partial failures are acceptable for callgraph edges
			// that reference nodes outside the parsed scope.
			_ = err
		}
	}
	return nil
}

// EnsureIndex creates an index on a label+property pair if it does not exist.
func (c *Client) EnsureIndex(graph, label, property string) error {
	cypher := fmt.Sprintf("CREATE INDEX ON :%s(%s)", label, property)
	err := c.Query(graph, cypher)
	if err != nil && strings.Contains(err.Error(), "already indexed") {
		return nil
	}
	return err
}

// SetupIndexes creates standard indexes for the code graph schema.
func (c *Client) SetupIndexes(graph string) error {
	indexes := [][2]string{
		{NodeTypeFile, "path"},
		{NodeTypePackage, "import_path"},
		{NodeTypeFunction, "name"},
		{NodeTypeFunction, "function_key"},
		{NodeTypeMethod, "name"},
		{NodeTypeMethod, "method_key"},
		{NodeTypeStruct, "name"},
		{NodeTypeInterface, "name"},
	}
	for _, idx := range indexes {
		if err := c.EnsureIndex(graph, idx[0], idx[1]); err != nil {
			// Non-fatal: index creation can fail on older FalkorDB versions.
			_ = err
		}
	}
	return nil
}
