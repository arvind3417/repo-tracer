import { useState, useEffect } from "react";
import type { TraceSession } from "../types";
import { getSession } from "../api";
import { StepCard } from "./StepCard";
import { ExportButton } from "./ExportButton";
import styles from "../styles/Timeline.module.css";

interface TimelineProps {
  sessionId: string | null;
  activeStep?: number;
  onStepClick?: (step: number) => void;
  workspace?: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function calcDuration(started: string, completed?: string): string {
  if (!completed) return "in progress";
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Timeline({ sessionId, activeStep, onStepClick, workspace }: TimelineProps) {
  const [session, setSession] = useState<TraceSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    setLoading(true);
    setError(null);
    setExpandedSteps(new Set());

    getSession(sessionId)
      .then((s) => {
        setSession(s);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message ?? "Failed to load session");
        setLoading(false);
      });
  }, [sessionId]);

  const toggleStep = (stepNum: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepNum)) {
        next.delete(stepNum);
      } else {
        next.add(stepNum);
      }
      return next;
    });
  };

  const handleStepClick = (stepNum: number) => {
    toggleStep(stepNum);
    onStepClick?.(stepNum);
  };

  if (!sessionId) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>&#9654;</span>
          <span className={styles.emptyText}>Select a trace session</span>
          <span className={styles.emptyHint}>
            or click "Load mock" to generate a sample trace
          </span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>error: {error}</div>
      </div>
    );
  }

  if (!session) return null;

  const sortedSteps = [...session.steps].sort((a, b) => a.step - b.step);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div className={styles.queryLabel}>query</div>
            <div className={styles.query}>{session.query}</div>
          </div>
          <ExportButton sessionId={session.session_id} workspace={workspace} />
        </div>
        <div className={styles.metadata}>
          <span className={styles.repoBadge}>{session.repo}</span>
          <span className={styles.dot}>·</span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>steps:</span>
            <span className={styles.metaValue}>{session.total_steps}</span>
          </span>
          <span className={styles.dot}>·</span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>started:</span>
            <span className={styles.metaValue}>{formatDate(session.started_at)}</span>
          </span>
          <span className={styles.dot}>·</span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>duration:</span>
            <span className={styles.metaValue}>
              {calcDuration(session.started_at, session.completed_at)}
            </span>
          </span>
        </div>
      </div>

      <div className={styles.steps}>
        {sortedSteps.map((step, i) => (
          <div
            key={step.step}
            className={styles.stepWrapper}
            style={{
              animationDelay: `${i * 150}ms`,
              outline: step.step === activeStep ? "2px solid #f59e0b" : undefined,
              borderRadius: 6,
            }}
          >
            <StepCard
              step={step}
              index={i}
              isExpanded={expandedSteps.has(step.step)}
              onToggle={() => handleStepClick(step.step)}
            />
            {i < sortedSteps.length - 1 && (
              <div className={styles.connector} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
