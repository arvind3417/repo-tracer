import { useState } from "react";
import { SessionList } from "./components/SessionList";
import { Timeline } from "./components/Timeline";
import "./styles/globals.css";

const appStyles: React.CSSProperties = {
  display: "flex",
  height: "100vh",
  width: "100vw",
  overflow: "hidden",
  backgroundColor: "var(--bg-primary)",
};

const brandStyles: React.CSSProperties = {
  position: "absolute",
  top: "10px",
  left: "14px",
  fontSize: "11px",
  fontWeight: 700,
  color: "var(--accent-blue)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  opacity: 0.8,
  zIndex: 1,
  pointerEvents: "none",
};

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div style={appStyles}>
      <span style={brandStyles}>repo-tracer</span>
      <SessionList selectedId={selectedId} onSelect={setSelectedId} />
      <Timeline sessionId={selectedId} />
    </div>
  );
}
