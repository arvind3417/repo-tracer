package extractor

import (
	"fmt"
	"go/token"
	"go/types"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/callgraph"
	"golang.org/x/tools/go/callgraph/rta"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"

	"github.com/arvind3417/repo-tracer/parser/graph"
)

// CallGraphAnalyser uses golang.org/x/tools to extract CALLS and IMPLEMENTS edges.
type CallGraphAnalyser struct {
	repoPath  string
	repoName  string
	workspace string
}

// NewCallGraphAnalyser creates an analyser for the given repo.
func NewCallGraphAnalyser(repoPath, workspace string) *CallGraphAnalyser {
	repoPath = filepath.Clean(repoPath)
	return &CallGraphAnalyser{
		repoPath:  repoPath,
		repoName:  filepath.Base(repoPath),
		workspace: workspace,
	}
}

// Analyse loads packages from repoPath, builds an SSA program, runs RTA, and
// returns CALLS and IMPLEMENTS edges suitable for appending to a Result.
func (a *CallGraphAnalyser) Analyse() ([]graph.Edge, error) {
	cfg := &packages.Config{
		Mode: packages.NeedName |
			packages.NeedFiles |
			packages.NeedCompiledGoFiles |
			packages.NeedImports |
			packages.NeedTypes |
			packages.NeedTypesSizes |
			packages.NeedSyntax |
			packages.NeedTypesInfo |
			packages.NeedDeps,
		Dir:  a.repoPath,
		Fset: token.NewFileSet(),
		Tests: false,
	}

	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		return nil, fmt.Errorf("load packages: %w", err)
	}

	// Filter out packages with errors.
	var validPkgs []*packages.Package
	for _, p := range pkgs {
		if len(p.Errors) == 0 && p.Types != nil {
			validPkgs = append(validPkgs, p)
		}
	}

	if len(validPkgs) == 0 {
		// Fall back gracefully — return no edges rather than failing.
		return nil, nil
	}

	// Build SSA representation.
	prog, ssaPkgs := ssautil.AllPackages(validPkgs, ssa.InstantiateGenerics)
	prog.Build()

	// Collect main/init functions as RTA roots.
	var roots []*ssa.Function
	for _, sp := range ssaPkgs {
		if sp == nil {
			continue
		}
		if init := sp.Func("init"); init != nil {
			roots = append(roots, init)
		}
		if main := sp.Func("main"); main != nil {
			roots = append(roots, main)
		}
		// Include all exported functions as additional roots so we get a full graph.
		for _, mem := range sp.Members {
			if fn, ok := mem.(*ssa.Function); ok && fn.Signature != nil {
				roots = append(roots, fn)
			}
		}
	}

	if len(roots) == 0 {
		return a.implementsEdges(validPkgs), nil
	}

	// Run RTA callgraph analysis.
	result := rta.Analyze(roots, true)
	cg := result.CallGraph

	var edges []graph.Edge
	callgraph.GraphVisitEdges(cg, func(edge *callgraph.Edge) error {
		caller := edge.Caller.Func
		callee := edge.Callee.Func
		if caller == nil || callee == nil {
			return nil
		}

		callerPos := prog.Fset.Position(caller.Pos())
		calleePos := prog.Fset.Position(callee.Pos())

		callerFile := a.relPath(callerPos.Filename)
		calleeFile := a.relPath(calleePos.Filename)

		callerName := funcName(caller)
		calleeName := funcName(callee)

		if callerName == "" || calleeName == "" {
			return nil
		}

		edges = append(edges, graph.Edge{
			FromLabel: graph.NodeTypeFunction,
			FromKey:   "name",
			FromValue: callerName,
			ToLabel:   graph.NodeTypeFunction,
			ToKey:     "name",
			ToValue:   calleeName,
			Relation:  graph.EdgeCalls,
			Properties: map[string]interface{}{
				"caller_file": callerFile,
				"callee_file": calleeFile,
			},
		})
		return nil
	})

	// Append IMPLEMENTS edges.
	edges = append(edges, a.implementsEdges(validPkgs)...)
	return edges, nil
}

// implementsEdges checks each struct in each package against every interface
// in the same package and emits IMPLEMENTS edges.
func (a *CallGraphAnalyser) implementsEdges(pkgs []*packages.Package) []graph.Edge {
	var edges []graph.Edge

	for _, pkg := range pkgs {
		if pkg.Types == nil {
			continue
		}
		scope := pkg.Types.Scope()
		names := scope.Names()

		// Collect structs and interfaces in this package.
		var structTypes []*types.Named
		var ifaceTypes []*types.Named

		for _, name := range names {
			obj := scope.Lookup(name)
			if obj == nil {
				continue
			}
			tn, ok := obj.(*types.TypeName)
			if !ok {
				continue
			}
			named, ok := tn.Type().(*types.Named)
			if !ok {
				continue
			}
			switch named.Underlying().(type) {
			case *types.Struct:
				structTypes = append(structTypes, named)
			case *types.Interface:
				ifaceTypes = append(ifaceTypes, named)
			}
		}

		for _, st := range structTypes {
			stPtr := types.NewPointer(st)
			for _, iface := range ifaceTypes {
				ifaceType, ok := iface.Underlying().(*types.Interface)
				if !ok {
					continue
				}
				// Check both value receiver and pointer receiver.
				if types.Implements(st, ifaceType) || types.Implements(stPtr, ifaceType) {
					structPos := pkg.Fset.Position(st.Obj().Pos())
					ifacePos := pkg.Fset.Position(iface.Obj().Pos())
					edges = append(edges, graph.Edge{
						FromLabel: graph.NodeTypeStruct,
						FromKey:   "name",
						FromValue: st.Obj().Name(),
						ToLabel:   graph.NodeTypeInterface,
						ToKey:     "name",
						ToValue:   iface.Obj().Name(),
						Relation:  graph.EdgeImplements,
						Properties: map[string]interface{}{
							"struct_file": a.relPath(structPos.Filename),
							"iface_file":  a.relPath(ifacePos.Filename),
						},
					})
				}
			}
		}
	}
	return edges
}

// funcName returns a display name for an SSA function.
func funcName(fn *ssa.Function) string {
	if fn == nil {
		return ""
	}
	name := fn.Name()
	if fn.Package() != nil {
		pkgPath := fn.Package().Pkg.Path()
		// Strip the module path prefix to keep names short.
		parts := strings.Split(pkgPath, "/")
		if len(parts) > 0 {
			name = parts[len(parts)-1] + "." + name
		}
	}
	return name
}

// relPath converts an absolute filename to a path relative to the repo root.
func (a *CallGraphAnalyser) relPath(abs string) string {
	if abs == "" {
		return ""
	}
	rel, err := filepath.Rel(a.repoPath, abs)
	if err != nil {
		return abs
	}
	return rel
}
