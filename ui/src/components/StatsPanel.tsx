import { useState, useEffect } from "react";
import type { StatsResponse } from "../types";
import { getStats } from "../api";

const TOOL_COLOURS: Record<string, string> = {
  read_file:   "#3b82f6",
  glob_files:  "#22c55e",
  grep_files:  "#a855f7",
  grep_symbol: "#f59e0b",
  write_file:  "#ef4444",
};

function toolColour(tool: string): string {
  return TOOL_COLOURS[tool] ?? "#64748b";
}

export function StatsPanel() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getStats().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div
        style={{
          borderTop: "1px solid #1e293b",
          padding: "8px 12px",
          fontSize: 11,
          color: "#475569",
        }}
      >
        Loading stats...
      </div>
    );
  }

  if (!stats) return null;

  const maxVisits =
    stats.most_visited_files.length > 0
      ? stats.most_visited_files[0].visit_count
      : 1;

  return (
    <div
      style={{
        borderTop: "1px solid #1e293b",
        backgroundColor: "#080f1e",
        flexShrink: 0,
      }}
    >
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid #1e293b",
          padding: "7px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: "#94a3b8",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Workspace Stats
        </span>
        <span style={{ fontSize: 12, color: "#475569" }}>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

      {!collapsed && (
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Top numbers */}
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#3b82f6",
                  lineHeight: 1,
                }}
              >
                {stats.total_sessions}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                sessions
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#22c55e",
                  lineHeight: 1,
                }}
              >
                {stats.avg_steps_to_answer}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                avg steps
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#ef4444",
                  lineHeight: 1,
                }}
              >
                {stats.root_causes_found}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                root causes
              </div>
            </div>
          </div>

          {/* Top files mini bar chart */}
          {stats.most_visited_files.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#475569",
                  marginBottom: 6,
                }}
              >
                Top Files
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {stats.most_visited_files.slice(0, 5).map((f) => (
                  <div key={f.file} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#94a3b8",
                        width: 100,
                        flexShrink: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "monospace",
                      }}
                      title={f.file}
                    >
                      {f.file}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        backgroundColor: "#1e293b",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round((f.visit_count / maxVisits) * 100)}%`,
                          height: "100%",
                          backgroundColor: "#3b82f6",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        width: 20,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {f.visit_count}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool usage pills */}
          {Object.keys(stats.tool_usage).length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#475569",
                  marginBottom: 6,
                }}
              >
                Tool Usage
              </div>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: 5 }}
              >
                {Object.entries(stats.tool_usage)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tool, count]) => (
                    <span
                      key={tool}
                      style={{
                        backgroundColor: toolColour(tool) + "22",
                        border: `1px solid ${toolColour(tool)}66`,
                        color: toolColour(tool),
                        fontSize: 10,
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tool} ×{count}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Repos */}
          {stats.repos_explored.length > 0 && (
            <div
              style={{ fontSize: 10, color: "#475569" }}
            >
              Repos:{" "}
              <span style={{ color: "#94a3b8" }}>
                {stats.repos_explored.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
