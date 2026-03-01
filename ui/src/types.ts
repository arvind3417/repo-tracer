export interface TraceStep {
  session_id: string;
  step: number;
  tool: string;
  target: string;
  reason: string;
  symbols_found: string[];
  next_decision?: string;
  duration_ms: number;
  timestamp: string;
  is_root_cause: boolean;
  repo?: string;
}

export interface TraceSession {
  session_id: string;
  query: string;
  repo: string;
  started_at: string;
  completed_at?: string;
  total_steps: number;
  steps: TraceStep[];
}

export interface SessionSummary {
  session_id: string;
  query: string;
  repo: string;
  started_at: string;
  total_steps: number;
}
