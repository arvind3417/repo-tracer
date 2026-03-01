import type { SessionSummary, TraceSession, TraceStep } from "./types";

const BASE = "http://localhost:8000/api";

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
