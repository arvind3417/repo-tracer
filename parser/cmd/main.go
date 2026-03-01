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

	repoPath, err := filepath.Abs(args[0])
	if err != nil {
		return fmt.Errorf("resolve repo path: %w", err)
	}

	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return fmt.Errorf("repo path does not exist: %s", repoPath)
	}

	if *graphName == "" {
		*graphName = *workspace
	}

	fmt.Printf("repo-tracer parse\n")
	fmt.Printf("  repo:      %s\n", repoPath)
	fmt.Printf("  workspace: %s\n", *workspace)
	fmt.Printf("  graph:     %s\n", *graphName)
	fmt.Printf("  falkordb:  %s\n\n", *falkorAddr)

	start := time.Now()

	// Phase 1: AST extraction.
	fmt.Println("Extracting nodes...")
	ext := extractor.New(repoPath, *workspace)
	result, err := ext.Extract()
	if err != nil {
		return fmt.Errorf("extraction failed: %w", err)
	}

	fmt.Printf("  Found %d nodes and %d edges (AST)\n", len(result.Nodes), len(result.Edges))

	// Phase 2: Callgraph + IMPLEMENTS analysis.
	fmt.Println("Analysing call graph...")
	cga := extractor.NewCallGraphAnalyser(repoPath, *workspace)
	cgEdges, err := cga.Analyse()
	if err != nil {
		// Non-fatal: warn and continue without callgraph edges.
		fmt.Fprintf(os.Stderr, "warning: callgraph analysis failed: %v\n", err)
	} else {
		result.Edges = append(result.Edges, cgEdges...)
		fmt.Printf("  Found %d additional call/implements edges\n", len(cgEdges))
	}

	// Phase 3: Write to FalkorDB.
	fmt.Println("Writing to FalkorDB...")
	client := graph.NewClient(*falkorAddr)
	defer client.Close()

	if err := client.Ping(); err != nil {
		return fmt.Errorf("cannot reach FalkorDB at %s: %w\n  Hint: run `make docker-up` first", *falkorAddr, err)
	}

	// Set up indexes for fast lookups.
	client.SetupIndexes(*graphName)

	if err := client.BatchWrite(*graphName, result.Nodes, result.Edges); err != nil {
		return fmt.Errorf("batch write: %w", err)
	}

	elapsed := time.Since(start)
	fmt.Printf("\nDone. %d nodes, %d edges in %s.\n",
		len(result.Nodes), len(result.Edges), elapsed.Round(time.Millisecond))
	fmt.Printf("\nOpen the FalkorDB browser: http://localhost:3000\n")
	fmt.Printf("Try: MATCH (f:Function)-[:CALLS]->(g:Function) RETURN f.name, g.name LIMIT 20\n")

	return nil
}

func printUsage() {
	fmt.Fprintf(os.Stderr, `Usage: repo-tracer parse <repo-path> [flags]

Flags:
  --workspace   workspace name (default: "default")
  --graph       FalkorDB graph name (default: workspace name)
  --falkordb    FalkorDB address (default: "localhost:6379")

Example:
  repo-tracer parse ./path/to/go/repo --workspace myproject
`)
}
