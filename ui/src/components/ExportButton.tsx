import { useState, useRef, useEffect } from "react";
import { exportUrl, getPermalink } from "../api";

interface ExportButtonProps {
  sessionId: string;
  workspace?: string;
}

export function ExportButton({ sessionId, workspace }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleJson = () => {
    window.open(exportUrl(sessionId, "json"), "_blank");
    setOpen(false);
  };

  const handleMarkdown = () => {
    window.open(exportUrl(sessionId, "markdown"), "_blank");
    setOpen(false);
  };

  const handlePermalink = async () => {
    setOpen(false);
    try {
      const url = await getPermalink(sessionId, workspace);
      await navigator.clipboard.writeText(url);
      showToast("Copied!");
    } catch {
      showToast("Failed to copy");
    }
  };

  const btnStyle: React.CSSProperties = {
    backgroundColor: "transparent",
    border: "1px solid #334155",
    color: "#94a3b8",
    borderRadius: 5,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontWeight: 600,
    letterSpacing: "0.03em",
    display: "flex",
    alignItems: "center",
    gap: 5,
  };

  const menuItemStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    color: "#cbd5e1",
    fontSize: 12,
    padding: "8px 14px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        style={btnStyle}
        onClick={() => setOpen((o) => !o)}
        title="Export trace"
      >
        &#8595; Export
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 7,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            zIndex: 200,
            overflow: "hidden",
            minWidth: 170,
          }}
        >
          <button
            style={menuItemStyle}
            onClick={handleJson}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.backgroundColor = "#0f172a")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")
            }
          >
            &#128190; Download JSON
          </button>
          <button
            style={menuItemStyle}
            onClick={handleMarkdown}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.backgroundColor = "#0f172a")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")
            }
          >
            &#128196; Download Markdown
          </button>
          <div style={{ height: 1, backgroundColor: "#0f172a", margin: "2px 0" }} />
          <button
            style={menuItemStyle}
            onClick={handlePermalink}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.backgroundColor = "#0f172a")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")
            }
          >
            &#128279; Copy permalink
          </button>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            backgroundColor: "#22c55e",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 18px",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            zIndex: 500,
            pointerEvents: "none",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
