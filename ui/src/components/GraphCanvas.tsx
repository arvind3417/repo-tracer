import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, GraphEdge, SubgraphResult } from "../types";

interface GraphCanvasProps {
  workspace: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraph: SubgraphResult | null;
  graphMode?: "full" | "path_neighbors";
  activeStep?: number;
  onNodeClick?: (nodeId: string, step: number) => void;
  // Diff mode props
  diffMode?: boolean;
  diffSharedSet?: Set<string> | null;
  diffOnlyASet?: Set<string> | null;
  diffOnlyBSet?: Set<string> | null;
}

// Colour palette keyed by node type
const NODE_COLOURS: Record<string, string> = {
  File:      "#6b7280",
  Function:  "#3b82f6",
  Method:    "#14b8a6",
  Struct:    "#a855f7",
  Interface: "#f97316",
  Unknown:   "#64748b",
};

function getNodeColour(type: string): string {
  return NODE_COLOURS[type] ?? NODE_COLOURS.Unknown;
}

// Cytoscape stylesheet — defined here so it doesn't depend on the cytoscape module types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GRAPH_STYLES: any[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      label: "data(label)",
      color: "#e2e8f0",
      "font-size": "9px",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 4,
      width: 28,
      height: 28,
      "border-width": 2,
      "border-color": "#1e293b",
    },
  },
  {
    selector: "node[type = 'File']",
    style: { shape: "round-rectangle", width: 52, height: 26, "font-size": "10px", "font-weight": 700 },
  },
  {
    selector: "node[type = 'Struct']",
    style: { shape: "diamond" },
  },
  {
    selector: "node[type = 'Interface']",
    style: { shape: "hexagon" },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#334155",
      "target-arrow-color": "#334155",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      opacity: 0.7,
    },
  },
  {
    selector: "edge.trace-path",
    style: {
      width: 4,
      "line-color": "#f59e0b",
      "target-arrow-color": "#f59e0b",
      opacity: 0.95,
      "z-index": 9999,
    },
  },
  {
    selector: "node.visited",
    style: {
      "border-color": "#f59e0b",
      "border-width": 3,
    },
  },
  {
    selector: "node.active",
    style: {
      "border-color": "#fbbf24",
      "border-width": 4,
      "background-color": "#fbbf24",
      color: "#0f172a",
    },
  },
  {
    selector: "node.ghost",
    style: {
      "border-style": "dashed",
      "border-color": "#475569",
      "background-color": "#1e293b",
      color: "#64748b",
      opacity: 0.7,
    },
  },
  {
    selector: "node.building",
    style: {
      "border-color": "#93c5fd",
      "border-width": 4,
      "background-color": "#1e3a8a",
      width: 82,
      height: 36,
      "font-size": 11,
      "font-weight": 800,
    },
  },
  {
    selector: "node.flat",
    style: {
      shape: "ellipse",
      width: 30,
      height: 30,
      "background-color": "#334155",
      "border-color": "#94a3b8",
      "border-width": 2.5,
    },
  },
  {
    selector: "node.room",
    style: {
      shape: "triangle",
      width: 22,
      height: 22,
      "background-color": "#0ea5e9",
      "border-color": "#7dd3fc",
      "border-width": 2,
    },
  },
  {
    selector: "node.root-cause",
    style: {
      "border-color": "#ef4444",
      "border-width": 4,
    },
  },
  {
    selector: "edge.cross-repo",
    style: {
      "line-style": "dashed",
      "line-color": "#7c3aed",
      opacity: 0.5,
    },
  },
  {
    selector: ":parent",
    style: {
      "background-opacity": 0.08,
      "background-color": "#334155",
      "border-color": "#475569",
      "border-width": 1,
      label: "data(label)",
      "text-valign": "top",
      color: "#94a3b8",
      "font-size": "10px",
      "font-weight": 700,
    },
  },
];

export function GraphCanvas({
  workspace,
  nodes,
  edges,
  subgraph,
  graphMode = "full",
  activeStep,
  onNodeClick,
  diffMode,
  diffSharedSet,
  diffOnlyASet,
  diffOnlyBSet,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Build element definitions from nodes + edges
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildElements(): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: any[] = [];

    const visitedByStep = new Map<string, number>();
    const rootCauseIds = new Set<string>();

    if (subgraph) {
      for (const r of subgraph.resolved) {
        visitedByStep.set(r.node_id, r.visited_at_step);
        if (r.is_root_cause) rootCauseIds.add(r.node_id);
      }
    }
    const visitedIds = new Set(visitedByStep.keys());

    let renderNodes = nodes;
    let renderEdges = edges;
    if (graphMode === "path_neighbors" && visitedIds.size > 0) {
      const keep = new Set<string>(visitedIds);
      for (const e of edges) {
        if (visitedIds.has(e.source) || visitedIds.has(e.target)) {
          keep.add(e.source);
          keep.add(e.target);
        }
      }
      renderNodes = nodes.filter((n) => keep.has(n.id));
      renderEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
      // Metaphor mode: prioritize Building/Flat/Room; drop package noise.
      const keepTypes = new Set(["File", "Function", "Method"]);
      const keptIds = new Set(renderNodes.filter((n) => keepTypes.has(n.type)).map((n) => n.id));
      renderNodes = renderNodes.filter((n) => keptIds.has(n.id));
      renderEdges = renderEdges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
    }
    const isLargeGraph = renderNodes.length > 4000 || renderEdges.length > 8000;

    // Compound parents per repo are expensive for huge graphs; skip in large mode.
    if (!isLargeGraph) {
      const repos = new Set<string>();
      for (const n of renderNodes) {
        if (n.repo) repos.add(n.repo);
      }
      for (const repo of repos) {
        elements.push({
          data: { id: `__repo__${repo}`, label: repo, type: "repo" },
          classes: "repo-cluster",
        });
      }
    }

    const basename = (p?: string) => {
      if (!p) return "";
      const parts = p.split("/");
      return parts[parts.length - 1] || p;
    };

    // Regular nodes
    for (let i = 0; i < renderNodes.length; i++) {
      const n = renderNodes[i];
      const classes: string[] = [];
      const functionKind = String(n.function_kind ?? "");
      if (n.type === "File") {
        classes.push("building");
      } else if ((n.type === "Function" || n.type === "Method") && functionKind === "nested") {
        classes.push("room");
      } else if (n.type === "Function" || n.type === "Method") {
        classes.push("flat");
      }
      const step = visitedByStep.get(n.id);
      if (step !== undefined) classes.push("visited");
      if (rootCauseIds.has(n.id)) classes.push("root-cause");
      if (step !== undefined && step === activeStep) classes.push("active");

      // Diff mode colouring overrides
      let nodeColour = getNodeColour(n.type);
      if (diffMode) {
        if (diffSharedSet && diffSharedSet.has(n.id)) {
          nodeColour = "#22c55e";   // green = shared
          classes.push("diff-shared");
        } else if (diffOnlyASet && diffOnlyASet.has(n.id)) {
          nodeColour = "#3b82f6";   // blue = only in A
          classes.push("diff-only-a");
        } else if (diffOnlyBSet && diffOnlyBSet.has(n.id)) {
          nodeColour = "#f97316";   // orange = only in B
          classes.push("diff-only-b");
        }
      }

      let label = n.name || basename(n.file) || n.label || n.id;
      if (n.type === "File") {
        label = `BLDG ${basename(n.file || n.label || n.id)}`;
      } else if (n.type === "Function" || n.type === "Method") {
        const fn = (n.name || n.label || "").replace(/^.*\./, "");
        if (functionKind === "nested") {
          label = `ROOM ${fn || label}`;
        } else {
          label = `FLAT ${fn || label}`;
        }
      }
      const showLabel = !isLargeGraph || step !== undefined;

      // Deterministic positions for large graphs so first render is visible and fast.
      const cols = Math.max(1, Math.floor(Math.sqrt(renderNodes.length)));
      const x = (i % cols) * 28;
      const y = Math.floor(i / cols) * 22;

      elements.push({
        position: isLargeGraph ? { x, y } : undefined,
        data: {
          id: n.id,
          label: showLabel ? label : "",
          color: nodeColour,
          type: n.type,
          repo: n.repo,
          file: n.file,
          line: n.line,
          parent: !isLargeGraph && n.repo ? `__repo__${n.repo}` : undefined,
          visitedAtStep: step ?? null,
        },
        classes: classes.join(" "),
      });
    }

    // Ghost nodes
    if (subgraph && subgraph.ghosts.length > 0) {
      elements.push({
        data: { id: "__ghost_cluster__", label: "unresolved", type: "cluster" },
        classes: "repo-cluster",
      });
      for (const g of subgraph.ghosts) {
        const ghostId = `__ghost__${g.visited_at_step}`;
        const classes = ["ghost"];
        if (g.is_root_cause) classes.push("root-cause");
        if (g.visited_at_step === activeStep) classes.push("active");
        elements.push({
          data: {
            id: ghostId,
            label: g.target.split("/").pop() || g.target,
            color: "#1e293b",
            type: "ghost",
            parent: "__ghost_cluster__",
            visitedAtStep: g.visited_at_step,
          },
          classes: classes.join(" "),
        });
      }
    }

    // Edges
    const nodeIds = new Set(elements.map((e) => e.data.id));
    for (const e of renderEdges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
      const srcNode = renderNodes.find((n) => n.id === e.source);
      const dstNode = renderNodes.find((n) => n.id === e.target);
      const isCrossRepo = srcNode && dstNode && srcNode.repo !== dstNode.repo;
      elements.push({
        data: {
          id: e.id || `${e.source}__${e.target}`,
          source: e.source,
          target: e.target,
          type: e.type,
        },
        classes: isCrossRepo ? "cross-repo" : "",
      });
    }

    // Add explicit AI path edges between consecutive visited steps, even if
    // the graph has no direct edge between those nodes.
    if (subgraph) {
      const stepMap = new Map<number, string>();
      for (const r of subgraph.resolved) {
        if (r.node_id) stepMap.set(r.visited_at_step, r.node_id);
      }
      for (const g of subgraph.ghosts) {
        stepMap.set(g.visited_at_step, `__ghost__${g.visited_at_step}`);
      }
      const ordered = Array.from(stepMap.entries()).sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < ordered.length - 1; i++) {
        const [s1, n1] = ordered[i];
        const [s2, n2] = ordered[i + 1];
        if (!nodeIds.has(n1) || !nodeIds.has(n2)) continue;
        elements.push({
          data: {
            id: `__trace__${s1}_${s2}`,
            source: n1,
            target: n2,
            type: "TRACE_PATH",
          },
          classes: "trace-path",
        });
      }
    }

    return elements;
  }

  // Initialise / update Cytoscape (dynamic import to avoid build-time dep)
  useEffect(() => {
    if (!containerRef.current) return;

    const elements = buildElements();
    let cancelled = false;
    setRenderStatus("loading");

    import("cytoscape")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((mod: any) => {
        setLoadError(null);
        if (cancelled || !containerRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cytoscape = (mod as any).default ?? mod;

        const visitedIds = new Set((subgraph?.resolved ?? []).map((r) => r.node_id));
        let renderNodeCount = nodes.length;
        let renderEdgeCount = edges.length;
        if (graphMode === "path_neighbors" && visitedIds.size > 0) {
          const keep = new Set<string>(visitedIds);
          for (const e of edges) {
            if (visitedIds.has(e.source) || visitedIds.has(e.target)) {
              keep.add(e.source);
              keep.add(e.target);
            }
          }
          renderNodeCount = nodes.filter((n) => keep.has(n.id)).length;
          renderEdgeCount = edges.filter((e) => keep.has(e.source) && keep.has(e.target)).length;
        }
        const isLargeGraph = renderNodeCount > 4000 || renderEdgeCount > 8000;
        const layout = isLargeGraph
          ? { name: "preset", fit: true, padding: 20 }
          : { name: "cose" };

        if (!cyRef.current) {
          cyRef.current = cytoscape({
            container: containerRef.current,
            elements,
            style: GRAPH_STYLES,
            layout,
            userZoomingEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            pixelRatio: 1,
            hideEdgesOnViewport: isLargeGraph,
            textureOnViewport: isLargeGraph,
          });

          cyRef.current.on("tap", "node", (evt: { target: { id: () => string; data: (k: string) => number | null } }) => {
            const node = evt.target;
            const id: string = node.id();
            const step: number = node.data("visitedAtStep") ?? 0;
            if (!id.startsWith("__") && onNodeClick) {
              onNodeClick(id, step);
            }
          });
        } else {
          cyRef.current.elements().remove();
          cyRef.current.add(elements);
          cyRef.current.layout(layout).run();
        }
        setRenderStatus("ready");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(`Failed to load graph engine: ${msg}`);
        setRenderStatus("error");
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, subgraph, graphMode]);

  // Active step highlight + pan
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("active");
    if (activeStep == null) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeNode = cy.nodes().filter((n: any) => n.data("visitedAtStep") === activeStep);
    if (activeNode.length > 0) {
      activeNode.addClass("active");
      cy.animate(
        { center: { eles: activeNode }, zoom: cy.zoom() < 1.5 ? 1.5 : cy.zoom() },
        { duration: 400 }
      );
    }
  }, [activeStep]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  const isEmpty = nodes.length === 0;
  const showFallback = !isEmpty && renderStatus !== "ready";
  const fallbackDots = useMemo(() => {
    const cap = Math.min(nodes.length, 1200);
    const dots: Array<{ left: number; top: number; color: string }> = [];
    for (let i = 0; i < cap; i++) {
      const n = nodes[i];
      dots.push({
        left: ((i * 37) % 1000) / 10,
        top: ((i * 53) % 1000) / 10,
        color: getNodeColour(n.type),
      });
    }
    return dots;
  }, [nodes]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundColor: "#0f172a",
        borderLeft: "1px solid #1e293b",
      }}
    >
      {isEmpty && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: "#475569",
            fontSize: 13,
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 28 }}>&#9903;</span>
          <span>No graph data</span>
          <span style={{ fontSize: 11 }}>Select a workspace to load the graph</span>
        </div>
      )}
      {!isEmpty && loadError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: "#fca5a5",
            fontSize: 13,
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 28 }}>&#9888;</span>
          <span>Graph failed to render</span>
          <span style={{ fontSize: 11 }}>{loadError}</span>
        </div>
      )}
      {showFallback && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 20% 20%, rgba(59,130,246,0.14), transparent 40%), radial-gradient(circle at 80% 70%, rgba(245,158,11,0.12), transparent 35%)",
            zIndex: 1,
            overflow: "hidden",
          }}
        >
          {fallbackDots.map((d, idx) => (
            <span
              key={idx}
              style={{
                position: "absolute",
                left: `${d.left}%`,
                top: `${d.top}%`,
                width: 3,
                height: 3,
                borderRadius: "50%",
                backgroundColor: d.color,
                opacity: 0.8,
              }}
            />
          ))}
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", display: isEmpty ? "none" : "block", zIndex: 2, position: "relative" }}
      />
      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          backgroundColor: "rgba(15,23,42,0.85)",
          border: "1px solid #1e293b",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 10,
          color: "#94a3b8",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          zIndex: 10,
        }}
      >
        {diffMode ? (
          <>
            <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 2 }}>Diff Mode</div>
            {[
              { colour: "#22c55e", label: "shared" },
              { colour: "#3b82f6", label: "only in A" },
              { colour: "#f97316", label: "only in B" },
            ].map(({ colour, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: colour,
                  }}
                />
                {label}
              </div>
            ))}
          </>
        ) : (
          <>
            {Object.entries(NODE_COLOURS).map(([type, colour]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: colour,
                  }}
                />
                {type}
              </div>
            ))}
            <div style={{ borderTop: "1px solid #1e293b", marginTop: 2, paddingTop: 4 }}>
              <span style={{ color: "#f59e0b" }}>amber border</span> = visited
            </div>
            <div>
              <span style={{ color: "#ef4444" }}>red border</span> = root cause
            </div>
          </>
        )}
      </div>
      {/* Workspace label */}
      {workspace && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            fontSize: 10,
            color: "#475569",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            zIndex: 10,
          }}
        >
          workspace: {workspace}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          fontSize: 10,
          color: "#94a3b8",
          backgroundColor: "rgba(2,6,23,0.72)",
          border: "1px solid #1e293b",
          borderRadius: 6,
          padding: "4px 8px",
          zIndex: 12,
        }}
      >
        nodes {nodes.length} | edges {edges.length} | status {renderStatus}
      </div>
    </div>
  );
}
