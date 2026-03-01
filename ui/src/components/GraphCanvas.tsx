import { useEffect, useRef } from "react";
import type { GraphNode, GraphEdge, SubgraphResult } from "../types";

interface GraphCanvasProps {
  workspace: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraph: SubgraphResult | null;
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
    style: { shape: "round-rectangle", width: 30, height: 20 },
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

    // Compound parents per repo
    const repos = new Set<string>();
    for (const n of nodes) {
      if (n.repo) repos.add(n.repo);
    }
    for (const repo of repos) {
      elements.push({
        data: { id: `__repo__${repo}`, label: repo, type: "repo" },
        classes: "repo-cluster",
      });
    }

    // Regular nodes
    for (const n of nodes) {
      const classes: string[] = [];
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

      elements.push({
        data: {
          id: n.id,
          label: n.name || n.label || n.id,
          color: nodeColour,
          type: n.type,
          repo: n.repo,
          file: n.file,
          line: n.line,
          parent: n.repo ? `__repo__${n.repo}` : undefined,
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
    for (const e of edges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
      const srcNode = nodes.find((n) => n.id === e.source);
      const dstNode = nodes.find((n) => n.id === e.target);
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

    return elements;
  }

  // Initialise / update Cytoscape (dynamic import to avoid build-time dep)
  useEffect(() => {
    if (!containerRef.current) return;

    const elements = buildElements();
    let cancelled = false;

    // Dynamic import — won't fail at build time if package isn't installed.
    // Use Function constructor to avoid TypeScript static analysis of the import path.
    const dynamicImport = new Function("specifier", "return import(specifier)");
    dynamicImport("cytoscape")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((mod: any) => {
        if (cancelled || !containerRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cytoscape = (mod as any).default ?? mod;

        if (!cyRef.current) {
          cyRef.current = cytoscape({
            container: containerRef.current,
            elements,
            style: GRAPH_STYLES,
            layout: { name: "cose" },
            userZoomingEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
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
          cyRef.current.layout({ name: "cose" }).run();
        }
      })
      .catch(() => {
        // Cytoscape not available — graph canvas will show the placeholder
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, subgraph]);

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
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", display: isEmpty ? "none" : "block" }}
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
    </div>
  );
}
