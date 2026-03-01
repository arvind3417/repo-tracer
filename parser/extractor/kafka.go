package extractor

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"

	"github.com/arvind3417/repo-tracer/parser/graph"
)

// producerMethods is the set of method/function names that indicate a Kafka
// message is being published to a topic.
var producerMethods = map[string]bool{
	"Publish":        true,
	"ProduceMessage": true,
	"Produce":        true,
	"SendMessage":    true,
	"WriteMessages":  true,
	"Write":          true,
}

// consumerMethods is the set of method/function names that indicate a Kafka
// topic subscription or consumption.
var consumerMethods = map[string]bool{
	"Subscribe": true,
	"Consume":   true,
	"Register":  true,
	"ReadMessage": true,
	"FetchMessage": true,
}

// kafkaNewMessageFuncs are standalone function names (not methods) that also
// indicate a publish pattern.
var kafkaNewMessageFuncs = map[string]bool{
	"NewMessage": true,
}

// DetectKafkaTopics scans all .go files in repoPath for Kafka producer and
// consumer patterns. String literals passed as topic arguments are extracted
// directly.
//
// Producer patterns:
//
//	.Publish(ctx, "topic-name", ...)
//	.ProduceMessage(ctx, "topic-name", ...)
//	kafka.NewMessage("topic-name", ...)
//	Publish(topicName, ...)         — first arg is a string literal
//
// Consumer patterns:
//
//	.Subscribe("topic-name")
//	.Consume(ctx, "topic-name", ...)
//	consumer.Register("topic-name", handler)
//
// Returns PRODUCES_EVENT and CONSUMES_EVENT edges plus KafkaTopic nodes.
// Confidence is "medium" for all detected patterns.
func DetectKafkaTopics(repoPath, repoName, workspace string) ([]graph.CrossRepoEdge, []graph.Node, error) {
	fset := token.NewFileSet()

	var edges []graph.CrossRepoEdge
	seenTopics := make(map[string]bool)
	var topicNodes []graph.Node

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
			return nil
		}

		file, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			return nil
		}

		relPath, _ := filepath.Rel(repoPath, path)

		ast.Inspect(file, func(n ast.Node) bool {
			callExpr, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}

			methodName, isMethod := callMethodName(callExpr)
			if methodName == "" {
				return true
			}

			isProducer := producerMethods[methodName] || kafkaNewMessageFuncs[methodName]
			isConsumer := consumerMethods[methodName]

			if !isProducer && !isConsumer {
				return true
			}

			// Extract the topic name from the first string-literal argument.
			// For method calls like .Publish(ctx, "topic", ...) the topic is
			// typically the second argument (index 1), but for calls like
			// .Subscribe("topic") it is the first (index 0). We scan all
			// arguments looking for any string literal.
			topicName := extractFirstStringLiteral(callExpr.Args)
			if topicName == "" {
				return true
			}

			containingFunc := findContainingFunc(file, callExpr.Pos())
			fromID := repoName + "::" + containingFunc

			var edgeType string
			if isProducer {
				edgeType = graph.EdgeProducesEvent
			} else {
				edgeType = graph.EdgeConsumesEvent
			}

			props := map[string]interface{}{
				"caller_file": relPath,
				"repo":        repoName,
				"is_method":   isMethod,
			}

			if isProducer {
				// Function -> KafkaTopic
				edges = append(edges, graph.CrossRepoEdge{
					From:       fromID,
					To:         topicName,
					Type:       edgeType,
					Confidence: "medium",
					Workspace:  workspace,
					FromLabel:  graph.NodeTypeFunction,
					FromKey:    "name",
					ToLabel:    graph.NodeTypeKafkaTopic,
					ToKey:      "name",
					Properties: props,
				})
			} else {
				// KafkaTopic -> Function  (CONSUMES_EVENT direction)
				edges = append(edges, graph.CrossRepoEdge{
					From:      topicName,
					To:        fromID,
					Type:      edgeType,
					Confidence: "medium",
					Workspace: workspace,
					FromLabel: graph.NodeTypeKafkaTopic,
					FromKey:   "name",
					ToLabel:   graph.NodeTypeFunction,
					ToKey:     "name",
					Properties: props,
				})
			}

			if !seenTopics[topicName] {
				seenTopics[topicName] = true
				topic := graph.KafkaTopic{
					Name:      topicName,
					Workspace: workspace,
				}
				topicNodes = append(topicNodes, topic.ToNode())
			}

			return true
		})

		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	return edges, topicNodes, nil
}

// callMethodName returns the method/function name for a call expression and
// whether it was a method call (receiver.Method vs plain Function).
func callMethodName(call *ast.CallExpr) (name string, isMethod bool) {
	switch fn := call.Fun.(type) {
	case *ast.SelectorExpr:
		return fn.Sel.Name, true
	case *ast.Ident:
		return fn.Name, false
	}
	return "", false
}

// extractFirstStringLiteral scans a slice of call arguments and returns the
// value of the first basic string literal found (unquoted). Returns "" if none.
func extractFirstStringLiteral(args []ast.Expr) string {
	for _, arg := range args {
		lit, ok := arg.(*ast.BasicLit)
		if !ok {
			continue
		}
		if lit.Kind.String() != "STRING" {
			continue
		}
		// Strip surrounding quotes.
		val := lit.Value
		if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
			return val[1 : len(val)-1]
		}
		if len(val) >= 2 && val[0] == '`' && val[len(val)-1] == '`' {
			return val[1 : len(val)-1]
		}
	}
	return ""
}
