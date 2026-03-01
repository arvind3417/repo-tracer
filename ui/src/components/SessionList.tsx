import { useState, useCallback } from "react";
import type { SessionSummary, DiffResponse } from "../types";
import { getSessions, createMockTrace } from "../api";
import { DiffSelector } from "./DiffSelector";
import styles from "../styles/SessionList.module.css";

interface SessionListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  sessions: SessionSummary[];
  onSessionsChange: (sessions: SessionSummary[]) => void;
  onDiffRequested: (diff: DiffResponse) => void;
  workspace: string;
}

function timeAgo(iso: string): string {
  try {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDay}d ago`;
  } catch {
    return "";
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

export function SessionList({
  selectedId,
  onSelect,
  sessions,
  onSessionsChange,
  onDiffRequested,
  workspace,
}: SessionListProps) {
  const [loadingMock, setLoadingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiffSelector, setShowDiffSelector] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await getSessions();
      onSessionsChange(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load sessions";
      setError(msg);
    }
  }, [onSessionsChange]);

  const handleLoadMock = async () => {
    setLoadingMock(true);
    try {
      const session = await createMockTrace();
      await fetchSessions();
      onSelect(session.session_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create mock";
      setError(msg);
    } finally {
      setLoadingMock(false);
    }
  };

  return (
    <div className={styles.container} style={{ position: "relative" }}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>trace sessions</div>
        <div style={{ display: "flex", gap: 6 }}>
          {sessions.length >= 2 && (
            <button
              className={styles.mockBtn}
              onClick={() => setShowDiffSelector(true)}
              title="Compare two sessions"
              style={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
            >
              Diff
            </button>
          )}
          <button
            className={styles.mockBtn}
            onClick={handleLoadMock}
            disabled={loadingMock}
          >
            {loadingMock ? (
              <span className={styles.loadingText}>generating...</span>
            ) : (
              <>+ Load mock</>
            )}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>error: {error}</div>}

      <div className={styles.list}>
        {sessions.length === 0 && !error ? (
          <div className={styles.empty}>
            No sessions yet.
            <div className={styles.emptyHint}>
              Click "Load mock" to get started.
            </div>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.session_id}
              className={`${styles.item} ${s.session_id === selectedId ? styles.itemActive : ""}`}
              onClick={() => onSelect(s.session_id)}
            >
              <div className={styles.itemQuery}>{truncate(s.query, 60)}</div>
              <div className={styles.itemMeta}>
                <span className={styles.repoBadge} title={s.repo}>
                  {s.repo}
                </span>
                <span className={styles.stepCount}>{s.total_steps} steps</span>
                <span className={styles.timeAgo}>{timeAgo(s.started_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {showDiffSelector && (
        <DiffSelector
          sessions={sessions}
          workspace={workspace}
          onDiffLoaded={(diff) => {
            setShowDiffSelector(false);
            onDiffRequested(diff);
          }}
          onClose={() => setShowDiffSelector(false)}
        />
      )}
    </div>
  );
}
