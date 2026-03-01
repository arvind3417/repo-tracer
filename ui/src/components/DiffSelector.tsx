import { useState } from "react";
import type { SessionSummary, DiffResponse } from "../types";
import { getDiff } from "../api";

interface DiffSelectorProps {
  sessions: SessionSummary[];
  workspace: string;
  onDiffLoaded: (diff: DiffResponse) => void;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.6)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panelStyle: React.CSSProperties = {
  backgroundColor: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 10,
  padding: 24,
  minWidth: 400,
  maxWidth: 560,
  width: "90vw",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  color: "#e2e8f0",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#94a3b8",
  marginBottom: 6,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  outline: "none",
  cursor: "pointer",
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function DiffSelector({
  sessions,
  workspace,
  onDiffLoaded,
  onClose,
}: DiffSelectorProps) {
  const [sessionA, setSessionA] = useState<string>(sessions[0]?.session_id ?? "");
  const [sessionB, setSessionB] = useState<string>(sessions[1]?.session_id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = async () => {
    if (!sessionA || !sessionB) return;
    if (sessionA === sessionB) {
      setError("Select two different sessions to compare.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const diff = await getDiff(sessionA, sessionB, workspace || undefined);
      onDiffLoaded(diff);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load diff");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#f1f5f9",
              letterSpacing: "0.02em",
            }}
          >
            Compare Sessions
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        <div>
          <div style={labelStyle}>Session A (left)</div>
          <select
            style={selectStyle}
            value={sessionA}
            onChange={(e) => setSessionA(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id.slice(0, 8)} — {truncate(s.query, 50)} ({s.repo})
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={labelStyle}>Session B (right)</div>
          <select
            style={selectStyle}
            value={sessionB}
            onChange={(e) => setSessionB(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id.slice(0, 8)} — {truncate(s.query, 50)} ({s.repo})
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            style={{
              color: "#f87171",
              fontSize: 12,
              backgroundColor: "rgba(239,68,68,0.1)",
              border: "1px solid #ef4444",
              borderRadius: 5,
              padding: "6px 10px",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              backgroundColor: "transparent",
              color: "#94a3b8",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "7px 16px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCompare}
            disabled={loading || !sessionA || !sessionB}
            style={{
              backgroundColor: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "7px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Comparing..." : "Compare"}
          </button>
        </div>
      </div>
    </div>
  );
}
