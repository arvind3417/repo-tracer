import type { DiffResponse, TraceStep } from "../types";

interface DiffViewProps {
  diff: DiffResponse;
}

function nodeKey(step: TraceStep): string {
  const target = step.target.replace(/:\d+(-\d+)?$/, "");
  return `${step.tool}:${target}`;
}

function stepLabel(step: TraceStep): string {
  return `Step ${step.step} — ${step.tool}: ${step.target}`;
}

const colContainerStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};

const colHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "#94a3b8",
  padding: "4px 8px",
  borderBottom: "1px solid #1e293b",
  marginBottom: 4,
};

function StepRow({
  step,
  status,
  isDivergence,
}: {
  step: TraceStep;
  status: "shared" | "only-a" | "only-b" | "empty";
  isDivergence: boolean;
}) {
  const bgColour =
    status === "shared"
      ? "#1e293b"
      : status === "only-a"
      ? "rgba(59,130,246,0.15)"
      : status === "only-b"
      ? "rgba(249,115,22,0.15)"
      : "transparent";

  const borderColour =
    status === "only-a"
      ? "#3b82f6"
      : status === "only-b"
      ? "#f97316"
      : "#334155";

  return (
    <div
      style={{
        backgroundColor: bgColour,
        border: isDivergence ? "2px solid #fbbf24" : `1px solid ${borderColour}`,
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        color: status === "empty" ? "transparent" : "#e2e8f0",
        position: "relative",
        minHeight: 42,
      }}
    >
      {isDivergence && (
        <span
          style={{
            position: "absolute",
            top: -10,
            left: 8,
            fontSize: 9,
            fontWeight: 700,
            color: "#fbbf24",
            backgroundColor: "#0f172a",
            padding: "1px 5px",
            borderRadius: 3,
            letterSpacing: "0.05em",
          }}
        >
          DIVERGENCE
        </span>
      )}
      {status !== "empty" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            <span
              style={{
                fontSize: 10,
                fontFamily: "monospace",
                color:
                  status === "only-a"
                    ? "#60a5fa"
                    : status === "only-b"
                    ? "#fb923c"
                    : "#94a3b8",
                marginRight: 6,
              }}
            >
              {step.tool}
            </span>
            <span style={{ fontSize: 11, color: "#cbd5e1", wordBreak: "break-all" }}>
              {step.target}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {step.reason.slice(0, 80)}
            {step.reason.length > 80 ? "..." : ""}
          </div>
        </>
      )}
    </div>
  );
}

export function DiffView({ diff }: DiffViewProps) {
  const stepsA = [...diff.steps_a].sort((a, b) => a.step - b.step);
  const stepsB = [...diff.steps_b].sort((a, b) => a.step - b.step);
  const maxLen = Math.max(stepsA.length, stepsB.length);

  const keysB = new Set(stepsB.map(nodeKey));
  const keysA = new Set(stepsA.map(nodeKey));

  const sharedA = diff.shared_nodes.length;
  const onlyA = diff.only_in_a.length;
  const onlyB = diff.only_in_b.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        height: "100%",
        overflow: "auto",
        backgroundColor: "#0f172a",
        color: "#e2e8f0",
      }}
    >
      {/* Summary bar */}
      <div
        style={{
          backgroundColor: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 13,
          color: "#94a3b8",
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: "#22c55e", fontWeight: 600 }}>
          Shared: {sharedA} nodes.{" "}
        </span>
        {diff.divergence_step != null ? (
          <>
            Diverged at step{" "}
            <span style={{ color: "#fbbf24", fontWeight: 600 }}>
              {diff.divergence_step}
            </span>
            .{" "}
          </>
        ) : (
          "No divergence. "
        )}
        <span style={{ color: "#60a5fa" }}>A: {onlyA} unique steps.</span>{" "}
        <span style={{ color: "#fb923c" }}>B: {onlyB} unique steps.</span>
      </div>

      <div
        style={{
          backgroundColor: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          color: "#94a3b8",
          fontStyle: "italic",
        }}
      >
        {diff.summary}
      </div>

      {/* Side-by-side columns */}
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        {/* Session A column */}
        <div style={colContainerStyle}>
          <div style={{ ...colHeaderStyle, color: "#60a5fa" }}>
            Session A
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontFamily: "monospace",
                color: "#475569",
              }}
            >
              {diff.session_a.slice(0, 8)}
            </span>
          </div>
          {Array.from({ length: maxLen }, (_, i) => {
            const step = stepsA[i];
            if (!step) {
              return (
                <div
                  key={i}
                  style={{
                    border: "1px dashed #1e293b",
                    borderRadius: 6,
                    minHeight: 42,
                    opacity: 0.3,
                  }}
                />
              );
            }
            const key = nodeKey(step);
            const status: "shared" | "only-a" | "empty" = keysB.has(key) ? "shared" : "only-a";
            const isDivergence =
              diff.divergence_step != null && step.step === diff.divergence_step;
            return (
              <StepRow
                key={step.step}
                step={step}
                status={status}
                isDivergence={isDivergence}
              />
            );
          })}
        </div>

        {/* Session B column */}
        <div style={colContainerStyle}>
          <div style={{ ...colHeaderStyle, color: "#fb923c" }}>
            Session B
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontFamily: "monospace",
                color: "#475569",
              }}
            >
              {diff.session_b.slice(0, 8)}
            </span>
          </div>
          {Array.from({ length: maxLen }, (_, i) => {
            const step = stepsB[i];
            if (!step) {
              return (
                <div
                  key={i}
                  style={{
                    border: "1px dashed #1e293b",
                    borderRadius: 6,
                    minHeight: 42,
                    opacity: 0.3,
                  }}
                />
              );
            }
            const key = nodeKey(step);
            const status: "shared" | "only-b" | "empty" = keysA.has(key) ? "shared" : "only-b";
            const isDivergence =
              diff.divergence_step != null && step.step === diff.divergence_step;
            return (
              <StepRow
                key={step.step}
                step={step}
                status={status}
                isDivergence={isDivergence}
              />
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          fontSize: 11,
          color: "#64748b",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span>Legend:</span>
        <span
          style={{
            backgroundColor: "#1e293b",
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid #334155",
          }}
        >
          grey = shared
        </span>
        <span
          style={{
            backgroundColor: "rgba(59,130,246,0.15)",
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid #3b82f6",
            color: "#60a5fa",
          }}
        >
          blue = only in A
        </span>
        <span
          style={{
            backgroundColor: "rgba(249,115,22,0.15)",
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid #f97316",
            color: "#fb923c",
          }}
        >
          orange = only in B
        </span>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            border: "2px solid #fbbf24",
            color: "#fbbf24",
          }}
        >
          amber border = divergence
        </span>
      </div>
    </div>
  );
}

// Suppress unused import warning for stepLabel
void stepLabel;
