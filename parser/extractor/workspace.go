package extractor

import (
	"fmt"
	"path/filepath"

	"github.com/arvind3417/repo-tracer/parser/graph"
)

// WorkspaceResult holds all nodes and edges from parsing multiple repos in a
// shared workspace.
type WorkspaceResult struct {
	Repos        []string
	Nodes        []graph.Node
	Edges        []graph.Edge
	CrossEdges   []graph.CrossRepoEdge
	KafkaTopics  map[string]*graph.Node // topic name -> node, for cross-repo matching
	GRPCServices map[string]*graph.Node // service name -> node
}

// ParseWorkspace parses multiple repos and resolves cross-repo edges.
//
// For each repo it:
//  1. Runs the standard AST extractor (Phase 1).
//  2. Runs go.mod dependency analysis (DEPENDS_ON edges).
//  3. Detects gRPC client calls (CALLS_SERVICE edges + GRPCService nodes).
//  4. Detects Kafka produce/consume patterns (PRODUCES_EVENT / CONSUMES_EVENT
//     edges + KafkaTopic nodes).
//
// After all repos are processed it resolves cross-repo Kafka connections:
// a producer in repo A and a consumer in repo B that share the same topic name
// are linked through the shared KafkaTopic node.
func ParseWorkspace(repoPaths []string, workspace string) (*WorkspaceResult, error) {
	wr := &WorkspaceResult{
		KafkaTopics:  make(map[string]*graph.Node),
		GRPCServices: make(map[string]*graph.Node),
	}

	// ------------------------------------------------------------------
	// Pass 1: collect module paths for all repos so that ParseGoMod can
	// resolve DEPENDS_ON edges between repos in the same workspace.
	// ------------------------------------------------------------------
	// knownRepos maps module path -> repo name (base directory name).
	knownRepos := make(map[string]string)
	repoNames := make([]string, 0, len(repoPaths))
	for _, rp := range repoPaths {
		rp = filepath.Clean(rp)
		repoName := filepath.Base(rp)
		repoNames = append(repoNames, repoName)

		modPath := ReadModulePath(rp)
		if modPath != "" {
			knownRepos[modPath] = repoName
		}
	}

	// ------------------------------------------------------------------
	// Pass 2: parse each repo.
	// ------------------------------------------------------------------
	for i, rp := range repoPaths {
		rp = filepath.Clean(rp)
		repoName := repoNames[i]

		wr.Repos = append(wr.Repos, repoName)
		fmt.Printf("  [%d/%d] Parsing %s ...\n", i+1, len(repoPaths), repoName)

		// --- AST extraction (Phase 1) ---
		ext := New(rp, workspace)
		result, err := ext.Extract()
		if err != nil {
			return nil, fmt.Errorf("extract repo %s: %w", repoName, err)
		}
		wr.Nodes = append(wr.Nodes, result.Nodes...)
		wr.Edges = append(wr.Edges, result.Edges...)

		// --- go.mod DEPENDS_ON edges ---
		gomodEdges, err := ParseGoMod(rp, repoName, workspace, knownRepos)
		if err != nil {
			// Non-fatal: warn and continue.
			fmt.Printf("    warning: go.mod parse for %s: %v\n", repoName, err)
		} else {
			wr.CrossEdges = append(wr.CrossEdges, gomodEdges...)
		}

		// --- gRPC CALLS_SERVICE edges ---
		grpcEdges, grpcNodes, err := DetectGRPCCalls(rp, repoName, workspace)
		if err != nil {
			fmt.Printf("    warning: gRPC detection for %s: %v\n", repoName, err)
		} else {
			wr.CrossEdges = append(wr.CrossEdges, grpcEdges...)
			for _, n := range grpcNodes {
				name, _ := n.Properties["name"].(string)
				if name != "" {
					if _, exists := wr.GRPCServices[name]; !exists {
						nodeCopy := n
						wr.GRPCServices[name] = &nodeCopy
						wr.Nodes = append(wr.Nodes, n)
					}
				}
			}
		}

		// --- Kafka PRODUCES_EVENT / CONSUMES_EVENT edges ---
		kafkaEdges, kafkaNodes, err := DetectKafkaTopics(rp, repoName, workspace)
		if err != nil {
			fmt.Printf("    warning: Kafka detection for %s: %v\n", repoName, err)
		} else {
			wr.CrossEdges = append(wr.CrossEdges, kafkaEdges...)
			for _, n := range kafkaNodes {
				name, _ := n.Properties["name"].(string)
				if name != "" {
					if _, exists := wr.KafkaTopics[name]; !exists {
						nodeCopy := n
						wr.KafkaTopics[name] = &nodeCopy
						wr.Nodes = append(wr.Nodes, n)
					}
				}
			}
		}
	}

	return wr, nil
}

// CrossEdgesAsEdges converts all CrossRepoEdges in the WorkspaceResult to
// generic graph.Edge values suitable for BatchWrite.
func (wr *WorkspaceResult) CrossEdgesAsEdges() []graph.Edge {
	edges := make([]graph.Edge, 0, len(wr.CrossEdges))
	for _, ce := range wr.CrossEdges {
		edges = append(edges, ce.ToEdge())
	}
	return edges
}
