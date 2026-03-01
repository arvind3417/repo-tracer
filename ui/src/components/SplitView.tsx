import { useState, useEffect } from "react";
import { SessionList } from "./SessionList";
import { Timeline } from "./Timeline";
import { GraphCanvas } from "./GraphCanvas";
import { DiffView } from "./DiffView";
import { StatsPanel } from "./StatsPanel";
import type { GraphNode, GraphEdge, SubgraphResult, SessionSummary, DiffResponse } from "../types";
import { getGraphNodes, getGraphEdges, getSubgraph, getSessions } from "../api";

interface SplitViewProps {
  workspace: string;
  initialSessionId?: string | null;
}

export function SplitView({ workspace, initialSessionId }: SplitViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [activeStep, setActiveStep] = useState<number | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  // Diff state
  const [diffResult, setDiffResult] = useState<DiffResponse | null>(null);
  const [diffMode, setDiffMode] = useState(false);

  // Graph data state
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [subgraph, setSubgraph] = useState<SubgraphResult | null>(null);

  // Load sessions list (for DiffSelector)
  useEffect(() => {
    getSessions().then(setSessions).catch(() => {});
  }, []);

  // If initialSessionId changes (e.g. from URL param) update selectedId
  useEffect(() => {
    if (initialSessionId) setSelectedId(initialSessionId);
  }, [initialSessionId]);

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

  const handleDiffLoaded = (diff: DiffResponse) => {
    setDiffResult(diff);
    setDiffMode(true);
  };

  const exitDiff = () => {
    setDiffMode(false);
    setDiffResult(null);
  };

  // Build diff node sets for graph colouring
  const diffSharedSet = diffMode && diffResult
    ? new Set(diffResult.shared_nodes)
    : null;
  const diffOnlyASet = diffMode && diffResult
    ? new Set(diffResult.only_in_a)
    : null;
  const diffOnlyBSet = diffMode && diffResult
    ? new Set(diffResult.only_in_b)
    : null;

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Left panel: SessionList + StatsPanel */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <SessionList
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (diffMode) exitDiff();
          }}
          sessions={sessions}
          onSessionsChange={setSessions}
          onDiffRequested={handleDiffLoaded}
          workspace={workspace}
        />
        <StatsPanel />
      </div>

      {/* Center panel: Timeline or DiffView */}
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
        {diffMode && diffResult ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 12px",
                borderBottom: "1px solid #1e293b",
                backgroundColor: "#0f172a",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Diff View
              </span>
              <button
                onClick={exitDiff}
                style={{
                  background: "none",
                  border: "1px solid #334155",
                  color: "#64748b",
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Exit Diff
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <DiffView diff={diffResult} />
            </div>
          </div>
        ) : (
          <Timeline
            sessionId={selectedId}
            activeStep={activeStep}
            onStepClick={handleStepClick}
            workspace={workspace}
          />
        )}
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
          diffMode={diffMode}
          diffSharedSet={diffSharedSet}
          diffOnlyASet={diffOnlyASet}
          diffOnlyBSet={diffOnlyBSet}
        />
      </div>
    </div>
  );
}
