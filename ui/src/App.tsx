import { useState, useEffect } from "react";
import { SplitView } from "./components/SplitView";
import type { WorkspaceSummary } from "./types";
import { getWorkspaces } from "./api";
import "./styles/globals.css";

const topBarStyles: React.CSSProperties = {
  height: 40,
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "0 16px",
  backgroundColor: "var(--bg-secondary, #0f172a)",
  borderBottom: "1px solid #1e293b",
  flexShrink: 0,
};

const brandStyles: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--accent-blue, #3b82f6)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  opacity: 0.9,
};

const labelStyles: React.CSSProperties = {
  fontSize: 11,
  color: "#475569",
  marginLeft: "auto",
  letterSpacing: "0.04em",
};

const selectStyles: React.CSSProperties = {
  backgroundColor: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 12,
  cursor: "pointer",
  outline: "none",
};

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");

  useEffect(() => {
    getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws.length > 0 && !selectedWorkspace) {
        setSelectedWorkspace(ws[0].workspace);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        backgroundColor: "var(--bg-primary, #020617)",
      }}
    >
      {/* Top bar */}
      <div style={topBarStyles}>
        <span style={brandStyles}>repo-tracer</span>

        <span style={labelStyles}>workspace</span>
        <select
          style={selectStyles}
          value={selectedWorkspace}
          onChange={(e) => setSelectedWorkspace(e.target.value)}
        >
          {workspaces.length === 0 && (
            <option value="">-- no workspaces --</option>
          )}
          {workspaces.map((w) => (
            <option key={w.workspace} value={w.workspace}>
              {w.workspace} ({w.node_count} nodes, {w.repo_count} repos)
            </option>
          ))}
        </select>
      </div>

      {/* Three-panel layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <SplitView workspace={selectedWorkspace} />
      </div>
    </div>
  );
}
