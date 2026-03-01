package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/arvind3417/repo-tracer/parser/extractor"
	"github.com/arvind3417/repo-tracer/parser/graph"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 || os.Args[1] != "parse" {
		printUsage()
		os.Exit(1)
	}

	// Parse flags starting after the "parse" sub-command.
	fs := flag.NewFlagSet("parse", flag.ExitOnError)
	workspace := fs.String("workspace", "default", "workspace name")
	graphName := fs.String("graph", "", "FalkorDB graph name (defaults to workspace name)")
	falkorAddr := fs.String("falkordb", "localhost:6379", "FalkorDB address")

	if err := fs.Parse(os.Args[2:]); err != nil {
		return fmt.Errorf("parse flags: %w", err)
	}

	args := fs.Args()
	if len(args) == 0 {
		printUsage()
		return fmt.Errorf("missing <repo-path> argument")
	}

	if *graphName == "" {
		*graphName = *workspace
	}

	// Resolve all repo paths to absolute paths.
	repoPaths := make([]string, 0, len(args))
	for _, arg := range args {
		abs, err := filepath.Abs(arg)
		if err != nil {
			return fmt.Errorf("resolve repo path %q: %w", arg, err)
		}
		if _, err := os.Stat(abs); os.IsNotExist(err) {
			return fmt.Errorf("repo path does not exist: %s", abs)
		}
		repoPaths = append(repoPaths, abs)
	}

	fmt.Printf("repo-tracer parse\n")
	fmt.Printf("  repos:     %v\n", repoPaths)
	fmt.Printf("  workspace: %s\n", *workspace)
	fmt.Printf("  graph:     %s\n", *graphName)
	fmt.Printf("  falkordb:  %s\n\n", *falkorAddr)

	start := time.Now()

	if len(repoPaths) == 1 {
		// ----------------------------------------------------------------
		// Single-repo mode — preserve the original Phase 1 behaviour with
		// the added call-graph analysis step.
		// ----------------------------------------------------------------
		return runSingleRepo(repoPaths[0], *workspace, *graphName, *falkorAddr, start)
	}

	// ----------------------------------------------------------------
	// Multi-repo mode — workspace coordinator orchestrates everything.
	// ----------------------------------------------------------------
	return runMultiRepo(repoPaths, *workspace, *graphName, *falkorAddr, start)
}

// runSingleRepo replicates Phase 1 behaviour for a single repo.
func runSingleRepo(repoPath, workspace, graphName, falkorAddr string, start time.Time) error {
	fmt.Println("Extracting nodes...")
	ext := extractor.New(repoPath, workspace)
	result, err := ext.Extract()
	if err != nil {
		return fmt.Errorf("extraction failed: %w", err)
	}
	fmt.Printf("  Found %d nodes and %d edges (AST)\n", len(result.Nodes), len(result.Edges))

	// Call-graph + IMPLEMENTS analysis.
	fmt.Println("Analysing call graph...")
	cga := extractor.NewCallGraphAnalyser(repoPath, workspace)
	cgEdges, err := cga.Analyse()
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: callgraph analysis failed: %v\n", err)
	} else {
		result.Edges = append(result.Edges, cgEdges...)
		fmt.Printf("  Found %d additional call/implements edges\n", len(cgEdges))
	}

	// Cross-repo detectors — still useful on a single repo for self-contained
	// gRPC / Kafka patterns.
	fmt.Println("Running cross-repo detectors (single-repo mode)...")

	grpcEdges, grpcNodes, grpcErr := extractor.DetectGRPCCalls(repoPath, workspace, workspace)
	if grpcErr != nil {
		fmt.Fprintf(os.Stderr, "warning: gRPC detection: %v\n", grpcErr)
	} else {
		fmt.Printf("  Found %d gRPC service calls, %d GRPCService nodes\n",
			len(grpcEdges), len(grpcNodes))
		result.Nodes = append(result.Nodes, grpcNodes...)
	}

	kafkaEdges, kafkaNodes, kafkaErr := extractor.DetectKafkaTopics(repoPath, workspace, workspace)
	if kafkaErr != nil {
		fmt.Fprintf(os.Stderr, "warning: Kafka detection: %v\n", kafkaErr)
	} else {
		fmt.Printf("  Found %d Kafka edge patterns, %d KafkaTopic nodes\n",
			len(kafkaEdges), len(kafkaNodes))
		result.Nodes = append(result.Nodes, kafkaNodes...)
	}

	// Write to FalkorDB.
	fmt.Println("\nWriting to FalkorDB...")
	client := graph.NewClient(falkorAddr)
	defer client.Close()

	if err := client.Ping(); err != nil {
		return fmt.Errorf("cannot reach FalkorDB at %s: %w\n  Hint: run `make docker-up` first", falkorAddr, err)
	}

	client.SetupIndexes(graphName)
	setupCrossRepoIndexes(client, graphName)

	if err := client.BatchWrite(graphName, result.Nodes, result.Edges); err != nil {
		return fmt.Errorf("batch write: %w", err)
	}

	// Write cross-repo edges.
	allCrossEdges := make([]graph.CrossRepoEdge, 0, len(grpcEdges)+len(kafkaEdges))
	allCrossEdges = append(allCrossEdges, grpcEdges...)
	allCrossEdges = append(allCrossEdges, kafkaEdges...)
	if len(allCrossEdges) > 0 {
		crossGraphEdges := make([]graph.Edge, 0, len(allCrossEdges))
		for _, ce := range allCrossEdges {
			crossGraphEdges = append(crossGraphEdges, ce.ToEdge())
		}
		if err := client.BatchWrite(graphName, nil, crossGraphEdges); err != nil {
			fmt.Fprintf(os.Stderr, "warning: cross-repo edge write: %v\n", err)
		}
	}

	elapsed := time.Since(start)
	fmt.Printf("\nDone. %d nodes, %d edges, %d cross-repo edges in %s.\n",
		len(result.Nodes), len(result.Edges), len(allCrossEdges), elapsed.Round(time.Millisecond))
	fmt.Printf("\nOpen the FalkorDB browser: http://localhost:3000\n")
	fmt.Printf("Try: MATCH (f:Function)-[:CALLS]->(g:Function) RETURN f.name, g.name LIMIT 20\n")
	return nil
}

// runMultiRepo orchestrates parsing multiple repos in a shared workspace.
func runMultiRepo(repoPaths []string, workspace, graphName, falkorAddr string, start time.Time) error {
	fmt.Printf("Parsing %d repos in workspace %q ...\n", len(repoPaths), workspace)

	wr, err := extractor.ParseWorkspace(repoPaths, workspace)
	if err != nil {
		return fmt.Errorf("workspace parse failed: %w", err)
	}

	// Run call-graph analysis on each repo (non-fatal).
	fmt.Println("\nAnalysing call graphs per repo...")
	for i, rp := range repoPaths {
		repoName := wr.Repos[i]
		fmt.Printf("  [%d/%d] Call graph for %s ...\n", i+1, len(repoPaths), repoName)
		cga := extractor.NewCallGraphAnalyser(rp, workspace)
		cgEdges, cgErr := cga.Analyse()
		if cgErr != nil {
			fmt.Fprintf(os.Stderr, "    warning: callgraph for %s: %v\n", repoName, cgErr)
		} else {
			wr.Edges = append(wr.Edges, cgEdges...)
			fmt.Printf("    +%d call/implements edges\n", len(cgEdges))
		}
	}

	// Summary before writing.
	crossEdges := wr.CrossEdgesAsEdges()
	fmt.Printf("\nWorkspace summary:\n")
	fmt.Printf("  Repos:            %v\n", wr.Repos)
	fmt.Printf("  Total nodes:      %d\n", len(wr.Nodes))
	fmt.Printf("  Total edges:      %d\n", len(wr.Edges))
	fmt.Printf("  Cross-repo edges: %d\n", len(crossEdges))
	fmt.Printf("  Kafka topics:     %d\n", len(wr.KafkaTopics))
	fmt.Printf("  gRPC services:    %d\n", len(wr.GRPCServices))

	// Breakdown of cross-repo edges by type.
	edgeTypeCounts := make(map[string]int)
	for _, ce := range wr.CrossEdges {
		edgeTypeCounts[ce.Type]++
	}
	for t, cnt := range edgeTypeCounts {
		fmt.Printf("    %s: %d\n", t, cnt)
	}

	// Write to FalkorDB.
	fmt.Println("\nWriting to FalkorDB...")
	client := graph.NewClient(falkorAddr)
	defer client.Close()

	if err := client.Ping(); err != nil {
		return fmt.Errorf("cannot reach FalkorDB at %s: %w\n  Hint: run `make docker-up` first", falkorAddr, err)
	}

	client.SetupIndexes(graphName)
	setupCrossRepoIndexes(client, graphName)

	if err := client.BatchWrite(graphName, wr.Nodes, wr.Edges); err != nil {
		return fmt.Errorf("batch write nodes/edges: %w", err)
	}

	if len(crossEdges) > 0 {
		if err := client.BatchWrite(graphName, nil, crossEdges); err != nil {
			fmt.Fprintf(os.Stderr, "warning: cross-repo edge write: %v\n", err)
		}
	}

	elapsed := time.Since(start)
	fmt.Printf("\nDone. %d nodes, %d edges, %d cross-repo edges in %s.\n",
		len(wr.Nodes), len(wr.Edges), len(crossEdges), elapsed.Round(time.Millisecond))
	fmt.Printf("\nOpen the FalkorDB browser: http://localhost:3000\n")
	printCypherHints()
	return nil
}

// setupCrossRepoIndexes adds indexes for the new Phase 3.5 node types.
func setupCrossRepoIndexes(client *graph.Client, graphName string) {
	indexes := [][2]string{
		{graph.NodeTypeKafkaTopic, "name"},
		{graph.NodeTypeGRPCService, "name"},
	}
	for _, idx := range indexes {
		_ = client.EnsureIndex(graphName, idx[0], idx[1])
	}
}

func printCypherHints() {
	fmt.Println("\nUseful Cypher queries:")
	fmt.Println("  # Which repos depend on which?")
	fmt.Println("  MATCH (a:Repo)-[:DEPENDS_ON]->(b:Repo) RETURN a.name, b.name")
	fmt.Println()
	fmt.Println("  # Which functions call gRPC services?")
	fmt.Println("  MATCH (f:Function)-[:CALLS_SERVICE]->(s:GRPCService) RETURN f.name, f.repo, s.name")
	fmt.Println()
	fmt.Println("  # Full Kafka event flow across repos")
	fmt.Println("  MATCH (f:Function)-[:PRODUCES_EVENT]->(t:KafkaTopic)<-[:CONSUMES_EVENT]-(g:Function)")
	fmt.Println("  RETURN f.name, f.repo, t.name, g.name, g.repo")
}

func printUsage() {
	fmt.Fprintf(os.Stderr, `Usage: repo-tracer parse <repo-path> [<repo-path2> ...] [flags]

Flags:
  --workspace   workspace name (default: "default")
  --graph       FalkorDB graph name (default: workspace name)
  --falkordb    FalkorDB address (default: "localhost:6379")

Single-repo example:
  repo-tracer parse ./path/to/go/repo --workspace myproject

Multi-repo example:
  repo-tracer parse ./api ./payments-service --workspace razorpay
`)
}
