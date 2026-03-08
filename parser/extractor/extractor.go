package extractor

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"

	"github.com/arvind3417/repo-tracer/parser/graph"
)

// Result holds all nodes and edges extracted from a repository.
type Result struct {
	Nodes []graph.Node
	Edges []graph.Edge

	// Typed collections used by the callgraph analyser.
	Files      []graph.FileNode
	Packages   []graph.PackageNode
	Functions  []graph.FunctionNode
	Methods    []graph.MethodNode
	Structs    []graph.StructNode
	Interfaces []graph.InterfaceNode
}

// Extractor walks a Go repository and extracts code graph entities.
type Extractor struct {
	repoPath  string
	repoName  string
	workspace string
	fset      *token.FileSet

	result Result

	// Deduplication sets.
	seenPackages map[string]bool
	seenFiles    map[string]bool
	seenFuncs    map[string]bool
	seenMethods  map[string]bool
}

// New creates a new Extractor for the given repository path and workspace.
func New(repoPath, workspace string) *Extractor {
	repoPath = filepath.Clean(repoPath)
	repoName := filepath.Base(repoPath)
	return &Extractor{
		repoPath:     repoPath,
		repoName:     repoName,
		workspace:    workspace,
		fset:         token.NewFileSet(),
		seenPackages: make(map[string]bool),
		seenFiles:    make(map[string]bool),
		seenFuncs:    make(map[string]bool),
		seenMethods:  make(map[string]bool),
	}
}

// Extract walks all Go files under repoPath and populates the Result.
func (e *Extractor) Extract() (*Result, error) {
	// Emit a Repo node.
	repoNode := graph.RepoNode{
		Name:      e.repoName,
		Repo:      e.repoName,
		Workspace: e.workspace,
	}
	e.result.Nodes = append(e.result.Nodes, repoNode.ToNode())

	err := filepath.Walk(e.repoPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip hidden directories and vendor.
			base := filepath.Base(path)
			if base != "." && (strings.HasPrefix(base, ".") || base == "vendor") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		return e.processFile(path)
	})
	if err != nil {
		return nil, fmt.Errorf("walk %s: %w", e.repoPath, err)
	}
	return &e.result, nil
}

// processFile parses a single .go file and emits nodes and edges.
func (e *Extractor) processFile(path string) error {
	src, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}

	file, err := parser.ParseFile(e.fset, path, src, parser.ParseComments)
	if err != nil {
		// Tolerate parse errors in individual files.
		return nil
	}

	lineCount := bytes.Count(src, []byte("\n")) + 1
	relPath, _ := filepath.Rel(e.repoPath, path)
	pkgName := file.Name.Name

	// Determine the import path for this package by using the relative directory.
	relDir := filepath.Dir(relPath)
	var importPath string
	if relDir == "." {
		importPath = e.repoName
	} else {
		importPath = e.repoName + "/" + relDir
	}

	// Emit File node.
	fileNode := graph.FileNode{
		Path:      relPath,
		Package:   pkgName,
		LineCount: lineCount,
		Repo:      e.repoName,
		Workspace: e.workspace,
	}
	if !e.seenFiles[relPath] {
		e.seenFiles[relPath] = true
		e.result.Files = append(e.result.Files, fileNode)
		e.result.Nodes = append(e.result.Nodes, fileNode.ToNode())
	}

	// Emit Package node (deduplicated by import path).
	pkgNode := graph.PackageNode{
		Name:       pkgName,
		ImportPath: importPath,
		Repo:       e.repoName,
		Workspace:  e.workspace,
	}
	if !e.seenPackages[importPath] {
		e.seenPackages[importPath] = true
		e.result.Packages = append(e.result.Packages, pkgNode)
		e.result.Nodes = append(e.result.Nodes, pkgNode.ToNode())
	}

	// BELONGS_TO edge: File -> Package.
	e.result.Edges = append(e.result.Edges, graph.Edge{
		FromLabel: graph.NodeTypeFile,
		FromKey:   "path",
		FromValue: relPath,
		ToLabel:   graph.NodeTypePackage,
		ToKey:     "import_path",
		ToValue:   importPath,
		Relation:  graph.EdgeBelongsTo,
	})

	// IMPORTS edges: File -> imported Package.
	for _, imp := range file.Imports {
		impPath := strings.Trim(imp.Path.Value, `"`)
		// Emit a Package node for the imported package (may be external).
		impName := filepath.Base(impPath)
		impPkg := graph.PackageNode{
			Name:       impName,
			ImportPath: impPath,
			Repo:       e.repoName,
			Workspace:  e.workspace,
		}
		if !e.seenPackages[impPath] {
			e.seenPackages[impPath] = true
			e.result.Packages = append(e.result.Packages, impPkg)
			e.result.Nodes = append(e.result.Nodes, impPkg.ToNode())
		}
		e.result.Edges = append(e.result.Edges, graph.Edge{
			FromLabel: graph.NodeTypeFile,
			FromKey:   "path",
			FromValue: relPath,
			ToLabel:   graph.NodeTypePackage,
			ToKey:     "import_path",
			ToValue:   impPath,
			Relation:  graph.EdgeImports,
		})
	}

	// Walk declarations to extract functions, methods, structs, and interfaces.
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			e.processFuncDecl(d, relPath, importPath)
		case *ast.GenDecl:
			e.processGenDecl(d, relPath)
		}
	}

	return nil
}

// processFuncDecl emits a Function or Method node from an ast.FuncDecl.
func (e *Extractor) processFuncDecl(d *ast.FuncDecl, filePath, _ string) {
	start := e.fset.Position(d.Pos())
	end := e.fset.Position(d.End())

	sig := buildFuncSignature(d)

	if d.Recv != nil && len(d.Recv.List) > 0 {
		// Method.
		receiverType := fieldListTypeString(d.Recv)
		methodKey := fmt.Sprintf("%s:%s:%d:%d", filePath, receiverType+"."+d.Name.Name, start.Line, start.Column)
		if !e.seenMethods[methodKey] {
			e.seenMethods[methodKey] = true
		}
		mn := graph.MethodNode{
			Name:         d.Name.Name,
			MethodKey:    methodKey,
			ReceiverType: receiverType,
			FilePath:     filePath,
			LineStart:    start.Line,
			LineEnd:      end.Line,
			Signature:    sig,
			Repo:         filepath.Base(filepath.Dir(filepath.Dir(filePath))),
			Workspace:    "",
		}
		// Re-use the repo/workspace already stored but we need access to the extractor fields.
		// Patch them properly.
		mn.Repo = e.repoName
		mn.Workspace = e.workspace

		e.result.Methods = append(e.result.Methods, mn)
		e.result.Nodes = append(e.result.Nodes, mn.ToNode())

		// DEFINED_IN edge.
		e.result.Edges = append(e.result.Edges, graph.Edge{
			FromLabel: graph.NodeTypeMethod,
			FromKey:   "method_key",
			FromValue: methodKey,
			ToLabel:   graph.NodeTypeFile,
			ToKey:     "path",
			ToValue:   filePath,
			Relation:  graph.EdgeDefinedIn,
		})

		// Nested/local functions inside method body.
		e.processNestedFuncLits(d.Body, filePath, methodKey, receiverType+"."+d.Name.Name, graph.NodeTypeMethod)
	} else {
		// Function.
		functionKey := fmt.Sprintf("%s:%s:%d:%d", filePath, d.Name.Name, start.Line, start.Column)
		if !e.seenFuncs[functionKey] {
			e.seenFuncs[functionKey] = true
		}
		qualifiedName := fmt.Sprintf("%s::%s", filePath, d.Name.Name)
		fn := graph.FunctionNode{
			Name:          d.Name.Name,
			QualifiedName: qualifiedName,
			FunctionKey:   functionKey,
			Kind:          "top_level",
			FilePath:      filePath,
			LineStart:     start.Line,
			LineEnd:       end.Line,
			Signature:     sig,
			Repo:          e.repoName,
			Workspace:     e.workspace,
		}
		e.result.Functions = append(e.result.Functions, fn)
		e.result.Nodes = append(e.result.Nodes, fn.ToNode())

		// DEFINED_IN edge.
		e.result.Edges = append(e.result.Edges, graph.Edge{
			FromLabel: graph.NodeTypeFunction,
			FromKey:   "function_key",
			FromValue: functionKey,
			ToLabel:   graph.NodeTypeFile,
			ToKey:     "path",
			ToValue:   filePath,
			Relation:  graph.EdgeDefinedIn,
		})

		// Nested/local functions inside function body.
		e.processNestedFuncLits(d.Body, filePath, functionKey, d.Name.Name, graph.NodeTypeFunction)
	}
}

// processNestedFuncLits finds function literals in a parent body and emits
// nested Function nodes with CONTAINS + DEFINED_IN edges.
func (e *Extractor) processNestedFuncLits(body *ast.BlockStmt, filePath, parentKey, parentName, parentLabel string) {
	if body == nil {
		return
	}
	ordinal := 0
	ast.Inspect(body, func(n ast.Node) bool {
		lit, ok := n.(*ast.FuncLit)
		if !ok {
			return true
		}
		ordinal++
		start := e.fset.Position(lit.Pos())
		end := e.fset.Position(lit.End())
		name := fmt.Sprintf("%s$lambda%d@L%dC%d", parentName, ordinal, start.Line, start.Column)
		functionKey := fmt.Sprintf("%s:%s:%d:%d", filePath, name, start.Line, start.Column)
		if e.seenFuncs[functionKey] {
			return true
		}
		e.seenFuncs[functionKey] = true

		fn := graph.FunctionNode{
			Name:              name,
			QualifiedName:     fmt.Sprintf("%s::%s", filePath, name),
			FunctionKey:       functionKey,
			ParentFunctionKey: parentKey,
			Kind:              "nested",
			FilePath:          filePath,
			LineStart:         start.Line,
			LineEnd:           end.Line,
			Signature:         buildFuncTypeSignature(lit.Type),
			Repo:              e.repoName,
			Workspace:         e.workspace,
		}
		e.result.Functions = append(e.result.Functions, fn)
		e.result.Nodes = append(e.result.Nodes, fn.ToNode())

		e.result.Edges = append(e.result.Edges, graph.Edge{
			FromLabel: graph.NodeTypeFunction,
			FromKey:   "function_key",
			FromValue: functionKey,
			ToLabel:   graph.NodeTypeFile,
			ToKey:     "path",
			ToValue:   filePath,
			Relation:  graph.EdgeDefinedIn,
		})

		e.result.Edges = append(e.result.Edges, graph.Edge{
			FromLabel: parentLabel,
			FromKey:   keyForLabel(parentLabel),
			FromValue: parentKey,
			ToLabel:   graph.NodeTypeFunction,
			ToKey:     "function_key",
			ToValue:   functionKey,
			Relation:  graph.EdgeContains,
		})
		return true
	})
}

func keyForLabel(label string) string {
	if label == graph.NodeTypeMethod {
		return "method_key"
	}
	return "function_key"
}

// processGenDecl handles type declarations (struct, interface).
func (e *Extractor) processGenDecl(d *ast.GenDecl, filePath string) {
	if d.Tok != token.TYPE {
		return
	}
	for _, spec := range d.Specs {
		ts, ok := spec.(*ast.TypeSpec)
		if !ok {
			continue
		}
		pos := e.fset.Position(ts.Pos())
		switch ts.Type.(type) {
		case *ast.StructType:
			sn := graph.StructNode{
				Name:      ts.Name.Name,
				FilePath:  filePath,
				Line:      pos.Line,
				Repo:      e.repoName,
				Workspace: e.workspace,
			}
			e.result.Structs = append(e.result.Structs, sn)
			e.result.Nodes = append(e.result.Nodes, sn.ToNode())
		case *ast.InterfaceType:
			in := graph.InterfaceNode{
				Name:      ts.Name.Name,
				FilePath:  filePath,
				Line:      pos.Line,
				Repo:      e.repoName,
				Workspace: e.workspace,
			}
			e.result.Interfaces = append(e.result.Interfaces, in)
			e.result.Nodes = append(e.result.Nodes, in.ToNode())
		}
	}
}

// buildFuncSignature produces a human-readable signature string for a function.
func buildFuncSignature(d *ast.FuncDecl) string {
	var b strings.Builder
	b.WriteString("func ")
	if d.Recv != nil && len(d.Recv.List) > 0 {
		b.WriteString("(")
		b.WriteString(fieldListTypeString(d.Recv))
		b.WriteString(") ")
	}
	b.WriteString(d.Name.Name)
	b.WriteString("(")
	if d.Type.Params != nil {
		b.WriteString(fieldListString(d.Type.Params))
	}
	b.WriteString(")")
	if d.Type.Results != nil && len(d.Type.Results.List) > 0 {
		b.WriteString(" (")
		b.WriteString(fieldListString(d.Type.Results))
		b.WriteString(")")
	}
	return b.String()
}

// buildFuncTypeSignature renders a function literal type signature.
func buildFuncTypeSignature(ft *ast.FuncType) string {
	if ft == nil {
		return "func()"
	}
	var b strings.Builder
	b.WriteString("func(")
	if ft.Params != nil {
		b.WriteString(fieldListString(ft.Params))
	}
	b.WriteString(")")
	if ft.Results != nil && len(ft.Results.List) > 0 {
		b.WriteString(" (")
		b.WriteString(fieldListString(ft.Results))
		b.WriteString(")")
	}
	return b.String()
}

// fieldListString renders a *ast.FieldList as a comma-separated param string.
func fieldListString(fl *ast.FieldList) string {
	if fl == nil {
		return ""
	}
	parts := make([]string, 0, len(fl.List))
	for _, f := range fl.List {
		typ := typeString(f.Type)
		if len(f.Names) == 0 {
			parts = append(parts, typ)
		} else {
			names := make([]string, len(f.Names))
			for i, n := range f.Names {
				names[i] = n.Name
			}
			parts = append(parts, strings.Join(names, ", ")+" "+typ)
		}
	}
	return strings.Join(parts, ", ")
}

// fieldListTypeString returns the receiver type as a string (e.g. "*MyStruct").
func fieldListTypeString(fl *ast.FieldList) string {
	if fl == nil || len(fl.List) == 0 {
		return ""
	}
	return typeString(fl.List[0].Type)
}

// typeString converts an ast.Expr representing a type to a string.
func typeString(expr ast.Expr) string {
	if expr == nil {
		return ""
	}
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + typeString(t.X)
	case *ast.SelectorExpr:
		return typeString(t.X) + "." + t.Sel.Name
	case *ast.ArrayType:
		return "[]" + typeString(t.Elt)
	case *ast.MapType:
		return "map[" + typeString(t.Key) + "]" + typeString(t.Value)
	case *ast.InterfaceType:
		return "interface{}"
	case *ast.Ellipsis:
		return "..." + typeString(t.Elt)
	case *ast.FuncType:
		return "func"
	case *ast.ChanType:
		return "chan " + typeString(t.Value)
	case *ast.ParenExpr:
		return "(" + typeString(t.X) + ")"
	default:
		return fmt.Sprintf("%T", expr)
	}
}
