package extractor

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/arvind3417/repo-tracer/parser/graph"
)

// ReadModulePath reads the module path declared on the `module` line of a
// go.mod file found at repoPath/go.mod. Returns "" if not found.
func ReadModulePath(repoPath string) string {
	gomodPath := filepath.Join(repoPath, "go.mod")
	f, err := os.Open(gomodPath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "module ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "module "))
		}
	}
	return ""
}

// ParseGoMod reads go.mod in repoPath and returns DEPENDS_ON edges for every
// direct `require` entry that matches a known repo in the workspace.
// knownRepos maps module path -> repo name for repos present in the workspace.
func ParseGoMod(repoPath, repoName, workspace string, knownRepos map[string]string) ([]graph.CrossRepoEdge, error) {
	gomodPath := filepath.Join(repoPath, "go.mod")
	f, err := os.Open(gomodPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Not a Go module — silently return nothing.
			return nil, nil
		}
		return nil, fmt.Errorf("open go.mod at %s: %w", gomodPath, err)
	}
	defer f.Close()

	var edges []graph.CrossRepoEdge
	inRequireBlock := false

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		raw := scanner.Text()
		line := strings.TrimSpace(raw)

		// Detect the start/end of a require (...) block.
		if line == "require (" {
			inRequireBlock = true
			continue
		}
		if inRequireBlock && line == ")" {
			inRequireBlock = false
			continue
		}

		var modulePath string

		if inRequireBlock {
			// Inside a block: lines look like "\tgithub.com/foo/bar v1.2.3 // indirect"
			modulePath = extractModulePath(line)
		} else if strings.HasPrefix(line, "require ") {
			// Single-line: "require github.com/foo/bar v1.2.3"
			rest := strings.TrimPrefix(line, "require ")
			modulePath = extractModulePath(rest)
		}

		if modulePath == "" {
			continue
		}

		// Check if this module belongs to a repo in the workspace.
		targetRepo, ok := knownRepos[modulePath]
		if !ok {
			continue
		}

		edges = append(edges, graph.CrossRepoEdge{
			From:       repoName,
			To:         targetRepo,
			Type:       graph.EdgeDependsOn,
			Confidence: "high",
			Workspace:  workspace,
			FromLabel:  graph.NodeTypeRepo,
			FromKey:    "name",
			ToLabel:    graph.NodeTypeRepo,
			ToKey:      "name",
		})
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan go.mod at %s: %w", gomodPath, err)
	}

	return edges, nil
}

// extractModulePath parses the module path from a require line such as:
//
//	github.com/foo/bar v1.2.3
//	github.com/foo/bar v1.2.3 // indirect
//
// Returns the bare module path, or "" if the line is blank/comment.
func extractModulePath(line string) string {
	line = strings.TrimSpace(line)
	// Strip inline comments.
	if idx := strings.Index(line, "//"); idx >= 0 {
		line = strings.TrimSpace(line[:idx])
	}
	if line == "" {
		return ""
	}
	// The first field is the module path; the second is the version.
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}
