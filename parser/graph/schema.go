package graph

// Node types for the code knowledge graph.
const (
	NodeTypeRepo         = "Repo"
	NodeTypeFile         = "File"
	NodeTypePackage      = "Package"
	NodeTypeFunction     = "Function"
	NodeTypeMethod       = "Method"
	NodeTypeStruct       = "Struct"
	NodeTypeInterface    = "Interface"
	NodeTypeKafkaTopic   = "KafkaTopic"
	NodeTypeGRPCService  = "GRPCService"
)

// Edge relationship types.
const (
	EdgeImports    = "IMPORTS"
	EdgeCalls      = "CALLS"
	EdgeImplements = "IMPLEMENTS"
	EdgeDefinedIn  = "DEFINED_IN"
	EdgeBelongsTo  = "BELONGS_TO"

	// Cross-repo edge types.
	EdgeDependsOn     = "DEPENDS_ON"      // Repo -> Repo (from go.mod)
	EdgeCallsService  = "CALLS_SERVICE"   // Function -> GRPCService
	EdgeProducesEvent = "PRODUCES_EVENT"  // Function -> KafkaTopic
	EdgeConsumesEvent = "CONSUMES_EVENT"  // KafkaTopic -> Function
)

// KafkaTopic holds data for a Kafka topic node.
type KafkaTopic struct {
	Name      string
	Workspace string
}

func (k KafkaTopic) ToNode() Node {
	return Node{
		Label: NodeTypeKafkaTopic,
		Properties: map[string]interface{}{
			"name":      k.Name,
			"workspace": k.Workspace,
		},
	}
}

// GRPCService holds data for a gRPC service node.
type GRPCService struct {
	Name      string
	ProtoFile string
	Workspace string
}

func (g GRPCService) ToNode() Node {
	return Node{
		Label: NodeTypeGRPCService,
		Properties: map[string]interface{}{
			"name":       g.Name,
			"proto_file": g.ProtoFile,
			"workspace":  g.Workspace,
		},
	}
}

// CrossRepoEdge carries confidence metadata for cross-repository relationships.
type CrossRepoEdge struct {
	From       string // node ID / identifying value
	To         string // node ID / identifying value
	Type       string // edge type constant
	Confidence string // "high" or "medium"
	Workspace  string

	// Label and key fields used when writing to FalkorDB.
	FromLabel string
	FromKey   string
	ToLabel   string
	ToKey     string

	// Optional extra properties.
	Properties map[string]interface{}
}

// ToEdge converts a CrossRepoEdge into a generic Edge for batch writing.
func (c CrossRepoEdge) ToEdge() Edge {
	props := map[string]interface{}{
		"confidence": c.Confidence,
		"workspace":  c.Workspace,
	}
	for k, v := range c.Properties {
		props[k] = v
	}
	return Edge{
		FromLabel:  c.FromLabel,
		FromKey:    c.FromKey,
		FromValue:  c.From,
		ToLabel:    c.ToLabel,
		ToKey:      c.ToKey,
		ToValue:    c.To,
		Relation:   c.Type,
		Properties: props,
	}
}

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
