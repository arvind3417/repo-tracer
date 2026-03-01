import { useState, useRef, useEffect, useCallback } from "react";
import type { SearchResult } from "../types";
import { searchSessions } from "../api";

interface SearchBarProps {
  onSelectResult: (sessionId: string, step: number | null) => void;
}

export function SearchBar({ onSelectResult }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await searchSessions(q, 20);
      setResults(res);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (result: SearchResult) => {
    onSelectResult(result.session_id, result.matching_step);
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const fieldColour: Record<string, string> = {
    query: "#a78bfa",
    target: "#60a5fa",
    symbols_found: "#34d399",
    reason: "#fbbf24",
    next_decision: "#fb923c",
    repo: "#94a3b8",
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "flex", alignItems: "center" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 6,
          padding: "3px 10px",
          gap: 6,
          width: 240,
        }}
      >
        <span style={{ color: "#475569", fontSize: 13 }}>&#128269;</span>
        <input
          type="text"
          placeholder="Search sessions..."
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e2e8f0",
            fontSize: 12,
            flex: 1,
            width: "100%",
          }}
        />
        {loading && (
          <span style={{ color: "#475569", fontSize: 11 }}>...</span>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            zIndex: 300,
            maxHeight: 320,
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            minWidth: 320,
          }}
        >
          {results.map((r) => (
            <div
              key={`${r.session_id}-${r.matching_step}`}
              onClick={() => handleSelect(r)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #0f172a",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.backgroundColor = "#0f172a")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")
              }
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e2e8f0",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.query}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 10,
                }}
              >
                <span
                  style={{
                    backgroundColor: "#334155",
                    color: "#94a3b8",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  {r.repo}
                </span>
                {r.matching_field && (
                  <span
                    style={{
                      color: fieldColour[r.matching_field] ?? "#64748b",
                      fontFamily: "monospace",
                    }}
                  >
                    {r.matching_field}
                    {r.matching_step != null ? ` · step ${r.matching_step}` : ""}
                  </span>
                )}
                {r.match_excerpt && (
                  <span
                    style={{
                      color: "#64748b",
                      fontStyle: "italic",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 160,
                    }}
                  >
                    "{r.match_excerpt.slice(0, 60)}"
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && results.length === 0 && query.trim() && !loading && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            zIndex: 300,
            padding: "10px 14px",
            fontSize: 12,
            color: "#64748b",
            minWidth: 240,
          }}
        >
          No results for "{query}"
        </div>
      )}
    </div>
  );
}
