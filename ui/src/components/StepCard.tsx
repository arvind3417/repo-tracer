import type { TraceStep } from "../types";
import styles from "../styles/StepCard.module.css";

interface StepCardProps {
  step: TraceStep;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function getToolClass(tool: string): string {
  const t = tool.toLowerCase();
  if (t.includes("glob")) return styles.toolGlob;
  if (t.includes("read")) return styles.toolRead;
  if (t.includes("grep") || t.includes("search")) return styles.toolGrep;
  return styles.toolOther;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StepCard({ step, index: _index, isExpanded, onToggle }: StepCardProps) {
  const toolClass = getToolClass(step.tool);

  return (
    <div
      className={`${styles.card} ${step.is_root_cause ? styles.cardRootCause : ""}`}
      onClick={onToggle}
    >
      <div className={styles.header}>
        <span className={styles.stepNum}>[{step.step}]</span>
        <span className={`${styles.toolBadge} ${toolClass}`}>{step.tool}</span>
        <span className={styles.target} title={step.target}>
          {step.target}
        </span>
        <div className={styles.rightMeta}>
          {step.is_root_cause && (
            <span className={styles.rootCauseBadge}>root cause</span>
          )}
          <span className={styles.duration}>{formatDuration(step.duration_ms)}</span>
          <span className={`${styles.expandIcon} ${isExpanded ? styles.expandIconOpen : ""}`}>
            ▾
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className={styles.body}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>target</span>
            <span className={styles.rowValue}>{step.target}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>reason</span>
            <span className={styles.rowValue}>{step.reason}</span>
          </div>
          {step.symbols_found.length > 0 && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>found</span>
              <div className={styles.symbols}>
                {step.symbols_found.map((sym, i) => (
                  <span key={i} className={styles.symbol} title={sym}>
                    {sym}
                  </span>
                ))}
              </div>
            </div>
          )}
          {step.next_decision && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>next</span>
              <span className={`${styles.rowValue} ${styles.nextDecision}`}>
                {step.next_decision}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
