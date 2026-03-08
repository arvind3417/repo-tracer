import { useState, useEffect } from "react";
import { SplitView } from "./components/SplitView";
import { CinematicView } from "./components/CinematicView";
import { SearchBar } from "./components/SearchBar";
import type { WorkspaceSummary, SessionSummary } from "./types";
import { getWorkspaces, getSessions } from "./api";
import "./styles/globals.css";

const topBarStyles: React.CSSProperties = {
  height: 44,
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  gap: 12,
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
  flexShrink: 0,
};

const labelStyles: React.CSSProperties = {
  fontSize: 11,
  color: "#475569",
  marginLeft: "auto",
  letterSpacing: "0.04em",
  flexShrink: 0,
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
  flexShrink: 0,
};

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const [deepLinkSession, setDeepLinkSession] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "cinematic">("graph");

  // Deep link support: read ?session= and ?workspace= from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");
    const workspaceParam = params.get("workspace");
    const viewParam = params.get("view");

    if (sessionParam) {
      setDeepLinkSession(sessionParam);
    }
    if (viewParam === "cinematic") {
      setViewMode("cinematic");
    }

    getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (workspaceParam) {
        // Auto-select workspace from URL if it exists
        const found = ws.find((w) => w.workspace === workspaceParam);
        if (found) {
          setSelectedWorkspace(found.workspace);
          return;
        }
      }
      if (ws.length > 0 && !selectedWorkspace) {
        setSelectedWorkspace(ws[0].workspace);
      }
    });

    getSessions().then((ss) => {
      setSessions(ss);
      if (!sessionParam && ss.length > 0) {
        setDeepLinkSession(ss[0].session_id);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSelect = (sessionId: string, _step: number | null) => {
    setDeepLinkSession(sessionId);
  };

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

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setViewMode("graph")}
            style={{
              border: "1px solid #334155",
              backgroundColor: viewMode === "graph" ? "#1d4ed8" : "#0f172a",
              color: "#e2e8f0",
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Graph
          </button>
          <button
            onClick={() => setViewMode("cinematic")}
            style={{
              border: "1px solid #334155",
              backgroundColor: viewMode === "cinematic" ? "#1d4ed8" : "#0f172a",
              color: "#e2e8f0",
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cinematic
          </button>
        </div>

        {/* Search bar */}
        <SearchBar onSelectResult={handleSearchSelect} />

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

        <span style={{ ...labelStyles, marginLeft: 0 }}>session</span>
        <select
          style={{ ...selectStyles, minWidth: 240 }}
          value={deepLinkSession ?? ""}
          onChange={(e) => setDeepLinkSession(e.target.value || null)}
        >
          {sessions.length === 0 && (
            <option value="">-- no sessions --</option>
          )}
          {sessions.map((s) => (
            <option key={s.session_id} value={s.session_id}>
              {s.session_id.slice(0, 8)} — {s.query.slice(0, 42)}
            </option>
          ))}
        </select>
      </div>

      {/* Three-panel layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {viewMode === "cinematic" ? (
          <CinematicView workspace={selectedWorkspace} sessionId={deepLinkSession} />
        ) : (
          <SplitView
            workspace={selectedWorkspace}
            initialSessionId={deepLinkSession}
          />
        )}
      </div>
    </div>
  );
}
