import { useEffect, useMemo, useState } from "react";
import { getSession, getSubgraph } from "../api";
import type { TraceSession, SubgraphResult } from "../types";

interface CinematicViewProps {
  workspace: string;
  sessionId: string | null;
}

export function CinematicView({ workspace, sessionId }: CinematicViewProps) {
  const [session, setSession] = useState<TraceSession | null>(null);
  const [subgraph, setSubgraph] = useState<SubgraphResult | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 4>(2);

  useEffect(() => {
    if (!sessionId || !workspace) return;
    getSession(sessionId).then(setSession).catch(() => setSession(null));
    getSubgraph(workspace, sessionId).then(setSubgraph).catch(() => setSubgraph(null));
    setStepIdx(0);
    setPlaying(true);
  }, [sessionId, workspace]);

  const pathNodes = useMemo(() => {
    if (!session) return [];
    const resolved = subgraph?.resolved ?? [];
    const resolvedByStep = new Map<number, any>();
    for (const r of resolved) {
      resolvedByStep.set(r.visited_at_step, r);
    }
    return [...session.steps]
      .sort((a, b) => a.step - b.step)
      .map((s) => {
        const r = resolvedByStep.get(s.step);
        if (r) {
          return {
            step: s.step,
            label: (r.file?.split("/").pop() || r.file || r.name || s.target || s.tool),
            kind: "resolved" as const,
            tool: s.tool,
            target: s.target,
            reason: s.reason,
            resolvedType: r.node_type,
            resolvedFile: r.file,
            resolvedName: r.name,
          };
        }
        return {
          step: s.step,
          label: `unresolved: ${s.target || s.tool}`,
          kind: "ghost" as const,
          tool: s.tool,
          target: s.target,
          reason: s.reason,
          resolvedType: "Ghost",
          resolvedFile: "",
          resolvedName: "",
        };
      });
  }, [session, subgraph]);

  useEffect(() => {
    if (!playing || pathNodes.length <= 1) return;
    const id = setInterval(() => {
      setStepIdx((s) => (s + 1) % pathNodes.length);
    }, 2000 / speed);
    return () => clearInterval(id);
  }, [pathNodes.length, playing, speed]);

  const size = 760;
  const cx = size / 2;
  const cy = size / 2;
  const ringR = 248;
  const points = pathNodes.map((n, i) => {
    const a = (i / Math.max(1, pathNodes.length)) * Math.PI * 2 - Math.PI / 2;
    const radiusJitter = n.kind === "ghost" ? -18 : 0;
    return {
      x: cx + Math.cos(a) * (ringR + radiusJitter),
      y: cy + Math.sin(a) * (ringR + radiusJitter),
      label: n.label,
      step: n.step,
      kind: n.kind,
    };
  });
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const active = points[Math.min(stepIdx, Math.max(0, points.length - 1))];
  const activeNode = pathNodes[Math.min(stepIdx, Math.max(0, pathNodes.length - 1))];
  const trailUntil = Math.max(2, stepIdx + 1);
  const trailPoints = points.slice(0, trailUntil);
  const trailPolyline = trailPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const progressPct = pathNodes.length > 0 ? ((stepIdx + 1) / pathNodes.length) * 100 : 0;

  const stars = useMemo(() => {
    const base: Array<{ x: number; y: number; r: number; o: number }> = [];
    for (let i = 0; i < 180; i++) {
      const x = (i * 53) % 1000;
      const y = (i * 97) % 1000;
      const r = (i % 7 === 0) ? 1.8 : ((i % 3 === 0) ? 1.2 : 0.8);
      const o = 0.2 + ((i * 17) % 70) / 100;
      base.push({ x: x / 10, y: y / 10, r, o });
    }
    return base;
  }, []);

  const cameraScale = active ? 1.16 : 1;
  const tx = active ? (cx - active.x) * 0.18 : 0;
  const ty = active ? (cy - active.y) * 0.18 : 0;

  if (!sessionId) {
    return (
      <div style={{ color: "#94a3b8", padding: 24 }}>Select a session first to start cinematic replay.</div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", background: "#020617", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 20%, rgba(59,130,246,0.22), transparent 40%), radial-gradient(circle at 80% 80%, rgba(245,158,11,0.18), transparent 30%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(2,6,23,0.1), rgba(2,6,23,0.65))" }} />
      <div style={{ position: "absolute", top: 12, left: 14, color: "#e2e8f0", zIndex: 10 }}>
        <div style={{ fontSize: 11, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.08em" }}>Cinematic Replay</div>
        <div style={{ fontSize: 12, opacity: 0.9 }}>{session?.query || "Loading session..."}</div>
      </div>
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, display: "flex", gap: 8, alignItems: "center", background: "rgba(15,23,42,0.82)", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 10px", color: "#cbd5e1", fontSize: 12 }}>
        <button
          onClick={() => setPlaying((p) => !p)}
          style={{ border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span>Speed</span>
        {[1, 2, 4].map((v) => (
          <button
            key={v}
            onClick={() => setSpeed(v as 1 | 2 | 4)}
            style={{
              border: "1px solid #334155",
              background: speed === v ? "#1d4ed8" : "#0f172a",
              color: "#e2e8f0",
              borderRadius: 6,
              padding: "3px 7px",
              cursor: "pointer",
            }}
          >
            {v}x
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" style={{ position: "relative", zIndex: 2 }}>
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {stars.map((s, i) => (
          <circle key={i} cx={s.x * 7.6} cy={s.y * 7.6} r={s.r} fill="#93c5fd" opacity={s.o * 0.6} />
        ))}

        <g transform={`translate(${tx}, ${ty}) scale(${cameraScale})`} style={{ transition: "transform 850ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
        <circle cx={cx} cy={cy} r={140} fill="url(#planetFill)" opacity={0.9} filter="url(#softGlow)" />
        <defs>
          <radialGradient id="planetFill" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#1d4ed8" />
            <stop offset="70%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
        </defs>

        <ellipse cx={cx} cy={cy} rx={ringR + 6} ry={ringR - 34} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="1.2" />
        <ellipse cx={cx} cy={cy} rx={ringR - 14} ry={ringR - 62} fill="none" stroke="rgba(59,130,246,0.24)" strokeWidth="1.2" />
        <circle cx={cx} cy={cy} r={ringR} fill="none" stroke="#1e293b" strokeWidth="1.2" />

        {points.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="rgba(245,158,11,0.28)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 8"
          />
        )}
        {trailPoints.length > 1 && (
          <polyline
            points={trailPolyline}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow)"
          />
        )}

        {points.map((p, i) => {
          const isActive = i === stepIdx;
          return (
            <g key={`${p.step}-${p.label}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isActive ? 9 : 4.5}
                fill={isActive ? "#fbbf24" : (p.kind === "ghost" ? "#64748b" : "#60a5fa")}
                opacity={isActive ? 1 : 0.78}
                filter={isActive ? "url(#glow)" : undefined}
              />
              {isActive && (
                <text x={p.x + 12} y={p.y - 10} fill="#e2e8f0" fontSize="11">
                  Step {p.step}: {p.label}
                </text>
              )}
            </g>
          );
        })}

        {active && (
          <circle
            cx={active.x}
            cy={active.y}
            r={14}
            fill="none"
            stroke="#fbbf24"
            strokeWidth="1.5"
            opacity="0.8"
          >
            <animate attributeName="r" values="12;18;12" dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.85;0.35;0.85" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}

        {/* In-scene semantic labels */}
        <g opacity="0.95">
          <text x={cx} y={cy - 8} textAnchor="middle" fill="#e2e8f0" fontSize="12" fontWeight="700">
            REPO CORE
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" fill="#93c5fd" fontSize="10">
            {workspace}
          </text>

          <text x={cx + ringR - 26} y={cy - 10} textAnchor="start" fill="#f59e0b" fontSize="10">
            orbit path
          </text>
          <line
            x1={cx + ringR - 42}
            y1={cy - 16}
            x2={cx + ringR - 8}
            y2={cy - 40}
            stroke="#f59e0b"
            strokeWidth="1.2"
            opacity="0.8"
          />

          <text x={cx - 148} y={cy - 160} textAnchor="start" fill="#60a5fa" fontSize="10">
            blue = resolved node
          </text>
          <text x={cx - 148} y={cy - 144} textAnchor="start" fill="#94a3b8" fontSize="10">
            grey = unresolved node
          </text>
          <text x={cx - 148} y={cy - 128} textAnchor="start" fill="#fbbf24" fontSize="10">
            amber = active step
          </text>
        </g>
        </g>
      </svg>
      <div style={{ position: "absolute", bottom: 14, left: 14, right: 14, color: "#94a3b8", fontSize: 12, zIndex: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          type="range"
          min={0}
          max={Math.max(0, pathNodes.length - 1)}
          value={Math.min(stepIdx, Math.max(0, pathNodes.length - 1))}
          onChange={(e) => setStepIdx(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{pathNodes.length} steps | now at step {active?.step ?? "-"}</span>
          <span>{progressPct.toFixed(0)}% complete | workspace {workspace}</span>
        </div>
      </div>
      {activeNode && (
        <div
          style={{
            position: "absolute",
            right: 14,
            bottom: 76,
            width: 380,
            zIndex: 10,
            background: "rgba(2,6,23,0.86)",
            border: "1px solid #1e293b",
            borderRadius: 10,
            padding: "10px 12px",
            color: "#e2e8f0",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontSize: 11, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Current Step Details
          </div>
          <div><b>Step</b>: {activeNode.step}</div>
          <div><b>Tool</b>: {activeNode.tool}</div>
          <div><b>Target</b>: {activeNode.target || "-"}</div>
          <div><b>Resolved Type</b>: {activeNode.resolvedType}</div>
          <div><b>Resolved File</b>: {activeNode.resolvedFile || "-"}</div>
          <div><b>Resolved Name</b>: {activeNode.resolvedName || "-"}</div>
          <div style={{ marginTop: 6, color: "#cbd5e1" }}><b>Reason</b>: {activeNode.reason || "N/A"}</div>
        </div>
      )}
    </div>
  );
}
