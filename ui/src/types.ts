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

// --- Phase 5 types ---

export interface DiffResponse {
  session_a: string;
  session_b: string;
  shared_nodes: string[];
  only_in_a: string[];
  only_in_b: string[];
  divergence_step: number | null;
  divergence_node_a: string | null;
  divergence_node_b: string | null;
  steps_a: TraceStep[];
  steps_b: TraceStep[];
  summary: string;
}

export interface SearchResult {
  session_id: string;
  query: string;
  repo: string;
  started_at: string;
  matching_step: number | null;
  matching_field: string | null;
  match_excerpt: string | null;
}

export interface FileVisit {
  file: string;
  visit_count: number;
}

export interface FunctionVisit {
  name: string;
  visit_count: number;
}

export interface StatsResponse {
  total_sessions: number;
  avg_steps_to_answer: number;
  most_visited_files: FileVisit[];
  most_visited_functions: FunctionVisit[];
  tool_usage: Record<string, number>;
  root_causes_found: number;
  repos_explored: string[];
}
