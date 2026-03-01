package extractor

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/arvind3417/repo-tracer/parser/graph"
)

// grpcClientPattern matches constructor function names like NewXxxClient or
// NewYyyServiceClient, which are the generated gRPC client constructors.
var grpcClientPattern = regexp.MustCompile(`^New\w+Client$`)

// DetectGRPCCalls scans all .go files in repoPath for patterns like:
//
//	pb.NewXxxClient(conn)
//	xxxpb.NewYyyServiceClient(cc)
//
// Returns CALLS_SERVICE edges from the containing function to the service name,
// plus GRPCService nodes for each unique service found.
func DetectGRPCCalls(repoPath, repoName, workspace string) ([]graph.CrossRepoEdge, []graph.Node, error) {
	fset := token.NewFileSet()

	var edges []graph.CrossRepoEdge
	seenServices := make(map[string]bool)
	var serviceNodes []graph.Node

	err := filepath.Walk(repoPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			base := filepath.Base(path)
			if base != "." && (strings.HasPrefix(base, ".") || base == "vendor") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return nil // tolerate unreadable files
		}

		file, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			return nil // tolerate parse errors
		}

		relPath, _ := filepath.Rel(repoPath, path)

		// Walk every call expression in the file.
		ast.Inspect(file, func(n ast.Node) bool {
			callExpr, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}

			sel, ok := callExpr.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}

			methodName := sel.Sel.Name
			if !grpcClientPattern.MatchString(methodName) {
				return true
			}

			// Derive the service name: strip "New" prefix and "Client" suffix.
			// e.g. NewPaymentServiceClient -> PaymentService
			serviceName := strings.TrimPrefix(methodName, "New")
			serviceName = strings.TrimSuffix(serviceName, "Client")
			if serviceName == "" {
				return true
			}

			// Find the enclosing function name.
			containingFunc := findContainingFunc(file, callExpr.Pos())

			fromID := repoName + "::" + containingFunc

			edges = append(edges, graph.CrossRepoEdge{
				From:       fromID,
				To:         serviceName,
				Type:       graph.EdgeCallsService,
				Confidence: "medium",
				Workspace:  workspace,
				FromLabel:  graph.NodeTypeFunction,
				FromKey:    "name",
				ToLabel:    graph.NodeTypeGRPCService,
				ToKey:      "name",
				Properties: map[string]interface{}{
					"caller_file": relPath,
					"repo":        repoName,
				},
			})

			if !seenServices[serviceName] {
				seenServices[serviceName] = true
				svc := graph.GRPCService{
					Name:      serviceName,
					ProtoFile: "",
					Workspace: workspace,
				}
				serviceNodes = append(serviceNodes, svc.ToNode())
			}

			return true
		})

		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	return edges, serviceNodes, nil
}

// findContainingFunc walks the AST of file to find the name of the innermost
// FuncDecl that contains pos. Returns "unknown" if none is found.
func findContainingFunc(file *ast.File, pos token.Pos) string {
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		if fn.Body == nil {
			continue
		}
		if pos >= fn.Body.Lbrace && pos <= fn.Body.Rbrace {
			if fn.Recv != nil && len(fn.Recv.List) > 0 {
				recv := typeString(fn.Recv.List[0].Type)
				return recv + "." + fn.Name.Name
			}
			return fn.Name.Name
		}
	}
	return "unknown"
}
