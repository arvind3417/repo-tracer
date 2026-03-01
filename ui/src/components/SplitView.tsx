import { useState, useEffect } from "react";
import { SessionList } from "./SessionList";
import { Timeline } from "./Timeline";
import { GraphCanvas } from "./GraphCanvas";
import type { GraphNode, GraphEdge, SubgraphResult } from "../types";
import { getGraphNodes, getGraphEdges, getSubgraph } from "../api";

interface SplitViewProps {
  workspace: string;
}

export function SplitView({ workspace }: SplitViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number | undefined>(undefined);

  // Graph data state
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [subgraph, setSubgraph] = useState<SubgraphResult | null>(null);

  // Load graph nodes + edges when workspace changes
  useEffect(() => {
    if (!workspace) {
      setGraphNodes([]);
      setGraphEdges([]);
      return;
    }
    Promise.all([getGraphNodes(workspace), getGraphEdges(workspace)]).then(
      ([nodes, edges]) => {
        setGraphNodes(nodes);
        setGraphEdges(edges);
      }
    );
  }, [workspace]);

  // Load subgraph when session is selected
  useEffect(() => {
    if (!workspace || !selectedId) {
      setSubgraph(null);
      setActiveStep(undefined);
      return;
    }
    getSubgraph(workspace, selectedId).then((sg) => {
      setSubgraph(sg);
      // Auto-activate the first step
      if (sg && sg.resolved.length > 0) {
        const firstStep = Math.min(...sg.resolved.map((r) => r.visited_at_step));
        setActiveStep(firstStep);
      }
    });
  }, [workspace, selectedId]);

  const handleNodeClick = (_nodeId: string, step: number) => {
    if (step) setActiveStep(step);
  };

  const handleStepClick = (step: number) => {
    setActiveStep(step);
  };

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Left panel: SessionList */}
      <SessionList selectedId={selectedId} onSelect={setSelectedId} />

      {/* Center panel: Timeline */}
      <div
        style={{
          flex: "0 0 420px",
          minWidth: 320,
          maxWidth: 520,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Timeline
          sessionId={selectedId}
          activeStep={activeStep}
          onStepClick={handleStepClick}
        />
      </div>

      {/* Right panel: GraphCanvas */}
      <div style={{ flex: 1, height: "100%", minWidth: 0 }}>
        <GraphCanvas
          workspace={workspace}
          nodes={graphNodes}
          edges={graphEdges}
          subgraph={subgraph}
          activeStep={activeStep}
          onNodeClick={handleNodeClick}
        />
      </div>
    </div>
  );
}
