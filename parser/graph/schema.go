package graph

// Node types for the code knowledge graph.
const (
	NodeTypeRepo      = "Repo"
	NodeTypeFile      = "File"
	NodeTypePackage   = "Package"
	NodeTypeFunction  = "Function"
	NodeTypeMethod    = "Method"
	NodeTypeStruct    = "Struct"
	NodeTypeInterface = "Interface"
)

// Edge relationship types.
const (
	EdgeImports   = "IMPORTS"
	EdgeCalls     = "CALLS"
	EdgeImplements = "IMPLEMENTS"
	EdgeDefinedIn = "DEFINED_IN"
	EdgeBelongsTo = "BELONGS_TO"
)

// Node represents a graph node with a label and properties.
type Node struct {
	Label      string
	Properties map[string]interface{}
}

// Edge represents a directed relationship between two nodes.
type Edge struct {
	FromLabel string
	FromKey   string
	FromValue interface{}
	ToLabel   string
	ToKey     string
	ToValue   interface{}
	Relation  string
	Properties map[string]interface{}
}

// RepoNode holds data for a Repo node.
type RepoNode struct {
	Name      string
	Repo      string
	Workspace string
}

func (r RepoNode) ToNode() Node {
	return Node{
		Label: NodeTypeRepo,
		Properties: map[string]interface{}{
			"name":      r.Name,
			"repo":      r.Repo,
			"workspace": r.Workspace,
		},
	}
}

// FileNode holds data for a File node.
type FileNode struct {
	Path      string
	Package   string
	LineCount int
	Repo      string
	Workspace string
}

func (f FileNode) ToNode() Node {
	return Node{
		Label: NodeTypeFile,
		Properties: map[string]interface{}{
			"path":       f.Path,
			"package":    f.Package,
			"line_count": f.LineCount,
			"repo":       f.Repo,
			"workspace":  f.Workspace,
		},
	}
}

// PackageNode holds data for a Package node.
type PackageNode struct {
	Name       string
	ImportPath string
	Repo       string
	Workspace  string
}

func (p PackageNode) ToNode() Node {
	return Node{
		Label: NodeTypePackage,
		Properties: map[string]interface{}{
			"name":        p.Name,
			"import_path": p.ImportPath,
			"repo":        p.Repo,
			"workspace":   p.Workspace,
		},
	}
}

// FunctionNode holds data for a Function node.
type FunctionNode struct {
	Name      string
	FilePath  string
	LineStart int
	LineEnd   int
	Signature string
	Repo      string
	Workspace string
}

func (f FunctionNode) ToNode() Node {
	return Node{
		Label: NodeTypeFunction,
		Properties: map[string]interface{}{
			"name":       f.Name,
			"file_path":  f.FilePath,
			"line_start": f.LineStart,
			"line_end":   f.LineEnd,
			"signature":  f.Signature,
			"repo":       f.Repo,
			"workspace":  f.Workspace,
		},
	}
}

// MethodNode holds data for a Method node.
type MethodNode struct {
	Name         string
	ReceiverType string
	FilePath     string
	LineStart    int
	LineEnd      int
	Signature    string
	Repo         string
	Workspace    string
}

func (m MethodNode) ToNode() Node {
	return Node{
		Label: NodeTypeMethod,
		Properties: map[string]interface{}{
			"name":          m.Name,
			"receiver_type": m.ReceiverType,
			"file_path":     m.FilePath,
			"line_start":    m.LineStart,
			"line_end":      m.LineEnd,
			"signature":     m.Signature,
			"repo":          m.Repo,
			"workspace":     m.Workspace,
		},
	}
}

// StructNode holds data for a Struct node.
type StructNode struct {
	Name      string
	FilePath  string
	Line      int
	Repo      string
	Workspace string
}

func (s StructNode) ToNode() Node {
	return Node{
		Label: NodeTypeStruct,
		Properties: map[string]interface{}{
			"name":      s.Name,
			"file_path": s.FilePath,
			"line":      s.Line,
			"repo":      s.Repo,
			"workspace": s.Workspace,
		},
	}
}

// InterfaceNode holds data for an Interface node.
type InterfaceNode struct {
	Name      string
	FilePath  string
	Line      int
	Repo      string
	Workspace string
}

func (i InterfaceNode) ToNode() Node {
	return Node{
		Label: NodeTypeInterface,
		Properties: map[string]interface{}{
			"name":      i.Name,
			"file_path": i.FilePath,
			"line":      i.Line,
			"repo":      i.Repo,
			"workspace": i.Workspace,
		},
	}
}

// ImportsEdge represents a File -[IMPORTS]-> Package edge.
type ImportsEdge struct {
	FilePath   string
	ImportPath string
}

// CallsEdge represents a Function -[CALLS]-> Function edge.
type CallsEdge struct {
	CallerName string
	CallerFile string
	CalleeName string
	CalleeFile string
}

// ImplementsEdge represents a Struct -[IMPLEMENTS]-> Interface edge.
type ImplementsEdge struct {
	StructName    string
	StructFile    string
	InterfaceName string
	InterfaceFile string
}

// DefinedInEdge represents a Function/Method -[DEFINED_IN]-> File edge.
type DefinedInEdge struct {
	EntityLabel string
	EntityName  string
	EntityFile  string
	FilePath    string
}

// BelongsToEdge represents a File -[BELONGS_TO]-> Package edge.
type BelongsToEdge struct {
	FilePath   string
	ImportPath string
}
