import type {
  SessionSummary,
  TraceSession,
  TraceStep,
  GraphNode,
  GraphEdge,
  SubgraphResult,
  WorkspaceSummary,
} from "./types";

const BASE = "http://localhost:8000/api";

// --- Trace endpoints ---

export async function getSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${BASE}/traces`);
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json();
}

export async function getSession(id: string): Promise<TraceSession> {
  const res = await fetch(`${BASE}/traces/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch session ${id}: ${res.status}`);
  return res.json();
}

export async function getSteps(id: string): Promise<TraceStep[]> {
  const res = await fetch(`${BASE}/traces/${id}/steps`);
  if (!res.ok) throw new Error(`Failed to fetch steps for ${id}: ${res.status}`);
  return res.json();
}

export async function createMockTrace(): Promise<TraceSession> {
  const res = await fetch(`${BASE}/traces/mock`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create mock trace: ${res.status}`);
  return res.json();
}

// --- Graph endpoints (Phase 4) ---

export async function getWorkspaces(): Promise<WorkspaceSummary[]> {
  try {
    const res = await fetch(`${BASE}/graph/workspaces`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.workspaces ?? [];
  } catch {
    return [];
  }
}

export async function getGraphNodes(
  workspace: string,
  typeFilter?: string
): Promise<GraphNode[]> {
  try {
    const url = new URL(`${BASE}/graph/${encodeURIComponent(workspace)}/nodes`);
    if (typeFilter) url.searchParams.set("type", typeFilter);
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return data.nodes ?? [];
  } catch {
    return [];
  }
}

export async function getGraphEdges(workspace: string): Promise<GraphEdge[]> {
  try {
    const res = await fetch(`${BASE}/graph/${encodeURIComponent(workspace)}/edges`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.edges ?? [];
  } catch {
    return [];
  }
}

export async function getSubgraph(
  workspace: string,
  sessionId: string
): Promise<SubgraphResult | null> {
  try {
    const res = await fetch(
      `${BASE}/graph/${encodeURIComponent(workspace)}/subgraph?session_id=${encodeURIComponent(sessionId)}`
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
