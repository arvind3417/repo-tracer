// --- Trace types ---

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

// --- Graph types (Phase 4) ---

export interface GraphNode {
  id: string;
  label: string;
  type: string;       // File, Function, Method, Struct, Interface, …
  name: string;
  repo: string;
  file: string;
  line?: number | null;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  confidence?: string;
}

export interface ResolvedNode {
  node_id: string;
  node_type: string;
  name: string;
  file: string;
  repo: string;
  line: number | null;
  visited_at_step: number;
  is_root_cause: boolean;
  confidence: string;   // "exact" | "fuzzy" | "file-level"
}

export interface GhostNode {
  target: string;
  tool: string;
  visited_at_step: number;
  is_root_cause: boolean;
  reason: string;
}

export interface SubgraphResult {
  resolved: ResolvedNode[];
  ghosts: GhostNode[];
  edges: GraphEdge[];
  workspace: string;
  session_id: string;
  warning?: string;
}

export interface WorkspaceSummary {
  workspace: string;
  repo_count: number;
  node_count: number;
}
