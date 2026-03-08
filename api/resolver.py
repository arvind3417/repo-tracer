"""Trace target → FalkorDB node ID resolver (Phase 4 core)."""

from __future__ import annotations

import fnmatch
import logging
import re
from dataclasses import dataclass, field

from api.falkordb_client import FalkorDBClient
from api.models import TraceSession, TraceStep

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ResolvedNode:
    """A trace step that was successfully mapped to a FalkorDB node."""

    node_id: str
    node_type: str          # File, Function, Method, Struct, Interface, …
    name: str
    file: str
    repo: str
    line: int | None
    visited_at_step: int
    is_root_cause: bool
    confidence: str         # "exact", "fuzzy", "file-level"


@dataclass
class GhostNode:
    """A trace step that could not be resolved to a FalkorDB node."""

    target: str
    tool: str
    visited_at_step: int
    is_root_cause: bool
    reason: str             # "unresolved" or "cross-repo-boundary"


@dataclass
class SubgraphResult:
    """All resolved + ghost nodes for a trace session, plus connecting edges."""

    resolved: list[ResolvedNode]
    ghosts: list[GhostNode]
    edges: list[dict]
    workspace: str
    session_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_LINE_RANGE_RE = re.compile(r"^(.+?):(\d+)(?:-\d+)?$")  # path:N or path:N-M
_SYMBOL_IN_FILE_RE = re.compile(r"(.+?):(\d+)")           # "funcName in file.go:87"


def _parse_file_and_line(target: str) -> tuple[str, int | None]:
    """Extract (file_path, line_number|None) from a target string like path:N or path:N-M."""
    m = _LINE_RANGE_RE.match(target)
    if m:
        path = m.group(1)
        line = int(m.group(2))
        return path, line
    return target, None


def _normalise_path(path: str) -> str:
    """Strip leading ./ or absolute repo prefixes so paths are relative for comparison.

    Handles:
      ./chi.go                        → chi.go
      /private/tmp/.../test-go-repo/chi.go → chi.go
      internal/settlement/service.go  → internal/settlement/service.go
    """
    path = path.strip()
    if path.startswith("./"):
        path = path[2:]
    # For absolute paths, keep stripping leading dirs until the path
    # no longer starts with / — this handles arbitrary repo root prefixes.
    # We walk from the right, keeping the shortest suffix that looks like
    # a relative repo path (no leading /).
    if path.startswith("/"):
        # Return just the basename for now; _find_file_node does suffix matching
        path = path.lstrip("/")
    return path


def _path_tail(path: str) -> str:
    """Return the last N segments of a path (for fuzzy matching)."""
    parts = _normalise_path(path).replace("\\", "/").split("/")
    # Use at most 3 trailing segments
    return "/".join(parts[-3:]) if len(parts) >= 3 else "/".join(parts)


def _glob_to_falkor(pattern: str) -> str:
    """Convert a glob like 'internal/settlement/**' to a regex-like CONTAINS string."""
    # We'll do client-side filtering; just return the base prefix.
    return pattern.rstrip("*").rstrip("/")


# ---------------------------------------------------------------------------
# NodeResolver
# ---------------------------------------------------------------------------


class NodeResolver:
    """Maps trace step targets to FalkorDB node IDs."""

    def __init__(self, falkordb_client: FalkorDBClient, workspace: str) -> None:
        self.db = falkordb_client
        self.workspace = workspace
        self._node_cache: list[dict] | None = None  # lazily loaded

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def _all_nodes(self) -> list[dict]:
        if self._node_cache is None:
            self._node_cache = self._fetch_all_nodes()
        return self._node_cache

    def _fetch_all_nodes(self) -> list[dict]:
        """Fetch all nodes using explicit property projections (avoids compact decode issues)."""
        results = []
        # Fetch each node type separately with known properties
        label_queries = [
            ("File",      "MATCH (n:File)      RETURN id(n) AS _id, 'File'      AS _label, n.path AS path, n.name AS name, n.repo AS repo, n.workspace AS workspace, n.line_count AS line_count"),
            ("Function",  "MATCH (n:Function)  RETURN id(n) AS _id, 'Function'  AS _label, n.name AS name, n.file AS file, n.repo AS repo, n.line_start AS line_start, n.line_end AS line_end, n.signature AS signature, n.function_kind AS function_kind, n.parent_function_key AS parent_function_key, n.function_key AS function_key"),
            ("Method",    "MATCH (n:Method)    RETURN id(n) AS _id, 'Method'    AS _label, n.name AS name, n.file AS file, n.repo AS repo, n.line_start AS line_start, n.receiver_type AS receiver_type, n.method_key AS method_key"),
            ("Struct",    "MATCH (n:Struct)    RETURN id(n) AS _id, 'Struct'    AS _label, n.name AS name, n.file AS file, n.repo AS repo, n.line AS line"),
            ("Interface", "MATCH (n:Interface) RETURN id(n) AS _id, 'Interface' AS _label, n.name AS name, n.file AS file, n.repo AS repo, n.line AS line"),
            ("Package",   "MATCH (n:Package)   RETURN id(n) AS _id, 'Package'   AS _label, n.name AS name, n.import_path AS import_path, n.repo AS repo"),
        ]
        for label, cypher in label_queries:
            try:
                rows = self.db.query(self.workspace, cypher)
                for row in rows:
                    node = {k: v for k, v in row.items() if v is not None}
                    node["labels"] = [label]
                    results.append(node)
            except Exception as exc:
                logger.warning("Failed to fetch %s nodes: %s", label, exc)
        return results

    def _fetch_all_edges(self) -> list[dict]:
        """Fetch edges with explicit property projections."""
        try:
            rows = self.db.query(
                self.workspace,
                "MATCH (a)-[r]->(b) RETURN id(a) AS source, id(b) AS target, type(r) AS type LIMIT 5000",
            )
            return rows
        except Exception as exc:
            logger.warning("Failed to fetch edges: %s", exc)
            return []

    # ------------------------------------------------------------------
    # Resolution logic
    # ------------------------------------------------------------------

    def resolve(self, step: TraceStep) -> ResolvedNode | GhostNode:
        """Resolve a single trace step to a node or ghost."""
        tool = (step.tool or "").lower()
        target = step.target or ""

        try:
            if tool == "read_file":
                return self._resolve_read_file(step, target)
            elif tool == "glob_files":
                return self._resolve_glob(step, target)
            elif tool in ("grep_files", "grep_symbol"):
                return self._resolve_grep(step, target)
            else:
                # Generic fallback: treat as file path
                return self._resolve_read_file(step, target)
        except Exception as exc:
            logger.warning("Resolution error for step %s (%s): %s", step.step, target, exc)
            return GhostNode(
                target=target,
                tool=step.tool,
                visited_at_step=step.step,
                is_root_cause=step.is_root_cause,
                reason="unresolved",
            )

    def _resolve_read_file(self, step: TraceStep, target: str) -> ResolvedNode | GhostNode:
        """Resolve a read_file step (with or without a line number)."""
        file_path, line_num = _parse_file_and_line(target)
        file_path = _normalise_path(file_path)

        if line_num is not None:
            # Try exact function/method match at this line
            node = self._find_function_at_line(file_path, line_num)
            if node:
                return self._make_resolved(node, step, confidence="exact")

            # Fuzzy: any function whose line range contains this line
            node = self._find_function_containing_line(file_path, line_num)
            if node:
                return self._make_resolved(node, step, confidence="fuzzy")

        # Fall back to file-level node
        node = self._find_file_node(file_path)
        if node:
            return self._make_resolved(node, step, confidence="file-level")

        return GhostNode(
            target=target,
            tool=step.tool,
            visited_at_step=step.step,
            is_root_cause=step.is_root_cause,
            reason="unresolved",
        )

    def _resolve_glob(self, step: TraceStep, target: str) -> ResolvedNode | GhostNode:
        """Resolve a glob_files step to the most relevant file node."""
        pattern = target.replace("\\", "/")
        nodes = self._all_nodes()

        matched: list[dict] = []
        for n in nodes:
            labels = n.get("labels", [])
            if "File" not in labels:
                continue
            node_file = _normalise_path(str(n.get("file", n.get("path", n.get("name", "")))))
            if self._glob_match(node_file, pattern):
                matched.append(n)

        if not matched:
            # Try prefix-based match
            prefix = _glob_to_falkor(pattern)
            for n in nodes:
                labels = n.get("labels", [])
                if "File" not in labels:
                    continue
                node_file = _normalise_path(str(n.get("file", n.get("path", n.get("name", "")))))
                if node_file.startswith(prefix):
                    matched.append(n)

        if not matched:
            return GhostNode(
                target=target,
                tool=step.tool,
                visited_at_step=step.step,
                is_root_cause=step.is_root_cause,
                reason="unresolved",
            )

        # Prefer non-test files
        non_test = [n for n in matched if "_test" not in str(n.get("name", "")).lower()
                    and "test" not in str(n.get("file", "")).lower()]
        best = non_test[0] if non_test else matched[0]
        return self._make_resolved(best, step, confidence="fuzzy")

    def _resolve_grep(self, step: TraceStep, target: str) -> ResolvedNode | GhostNode:
        """Resolve a grep step by looking at symbols_found for file:line hints."""
        # symbols_found often contain "symbol in file.go:line"
        for symbol in (step.symbols_found or []):
            m = _SYMBOL_IN_FILE_RE.search(symbol)
            if m:
                file_part = m.group(1)
                line_num = int(m.group(2))
                # strip leading "... in " text
                if " in " in file_part:
                    file_part = file_part.split(" in ")[-1]
                file_part = _normalise_path(file_part.strip())
                node = self._find_function_at_line(file_part, line_num)
                if node:
                    return self._make_resolved(node, step, confidence="exact")
                node = self._find_file_node(file_part)
                if node:
                    return self._make_resolved(node, step, confidence="file-level")

        # Treat target as a symbol name — look for Function/Method
        nodes = self._all_nodes()
        for n in nodes:
            labels = n.get("labels", [])
            if any(l in labels for l in ("Function", "Method")):
                if n.get("name", "") == target:
                    return self._make_resolved(n, step, confidence="exact")

        return GhostNode(
            target=target,
            tool=step.tool,
            visited_at_step=step.step,
            is_root_cause=step.is_root_cause,
            reason="unresolved",
        )

    # ------------------------------------------------------------------
    # Node finders
    # ------------------------------------------------------------------

    def _find_function_at_line(self, file_path: str, line: int) -> dict | None:
        """Find a Function/Method node whose start_line == line (or close to it)."""
        nodes = self._all_nodes()
        tail = _path_tail(file_path)
        candidates: list[dict] = []

        for n in nodes:
            labels = n.get("labels", [])
            if not any(l in labels for l in ("Function", "Method")):
                continue
            node_file = _normalise_path(str(n.get("file", "")))
            if not self._path_matches(node_file, file_path, tail):
                continue
            start = n.get("line_start", n.get("start_line", n.get("line", None)))
            if start is not None and abs(int(start) - line) <= 5:
                candidates.append(n)
        if not candidates:
            return None
        return min(candidates, key=lambda n: self._function_rank(n, line))

    def _find_function_containing_line(self, file_path: str, line: int) -> dict | None:
        """Find a Function/Method whose line range contains the given line."""
        nodes = self._all_nodes()
        tail = _path_tail(file_path)

        candidates: list[dict] = []
        for n in nodes:
            labels = n.get("labels", [])
            if not any(l in labels for l in ("Function", "Method")):
                continue
            node_file = _normalise_path(str(n.get("file", "")))
            if not self._path_matches(node_file, file_path, tail):
                continue
            start = n.get("line_start", n.get("start_line", n.get("line", None)))
            end = n.get("line_end", n.get("end_line", None))
            if start is None:
                continue
            start = int(start)
            if end is not None:
                end = int(end)
                if start <= line <= end:
                    candidates.append(n)
            else:
                # No end line: pick closest function before the target line
                if start <= line:
                    candidates.append(n)

        if not candidates:
            return None
        # Prefer nested functions when line overlaps, then nearest/narrowest range.
        return min(candidates, key=lambda n: self._function_rank(n, line))

    @staticmethod
    def _function_rank(n: dict, line: int) -> tuple[int, int, int]:
        """Lower rank is better: nested > top-level, nearest start line, narrowest span."""
        kind = str(n.get("function_kind", ""))
        is_nested = 0 if kind == "nested" else 1
        start = int(n.get("line_start", n.get("start_line", n.get("line", 0))) or 0)
        end = n.get("line_end", n.get("end_line", None))
        try:
            end_i = int(end) if end is not None else start
        except (TypeError, ValueError):
            end_i = start
        span = max(1, end_i - start)
        dist = abs(start - line)
        return (is_nested, dist, span)

    def _find_file_node(self, file_path: str) -> dict | None:
        """Find a File node matching the given path."""
        nodes = self._all_nodes()
        tail = _path_tail(file_path)

        for n in nodes:
            labels = n.get("labels", [])
            if "File" not in labels:
                continue
            node_file = _normalise_path(str(n.get("file", n.get("path", n.get("name", "")))))
            if self._path_matches(node_file, file_path, tail):
                return n
        return None

    # ------------------------------------------------------------------
    # Path matching helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _path_matches(node_file: str, file_path: str, tail: str) -> bool:
        """Return True if node_file is a close match for file_path."""
        if node_file == file_path:
            return True
        if node_file.endswith(tail):
            return True
        # basename match
        node_base = node_file.split("/")[-1]
        target_base = file_path.split("/")[-1]
        if node_base and target_base and node_base == target_base:
            return True
        return False

    @staticmethod
    def _glob_match(path: str, pattern: str) -> bool:
        """Match a file path against a glob pattern."""
        # fnmatch treats ** like any directory
        if fnmatch.fnmatch(path, pattern):
            return True
        # Also try with the path as a suffix
        parts = pattern.split("**")
        if len(parts) == 2:
            prefix = parts[0].strip("/")
            suffix = parts[1].strip("/")
            if prefix and not path.startswith(prefix):
                return False
            if suffix and not path.endswith(suffix):
                return False
            if prefix or suffix:
                return True
        return False

    # ------------------------------------------------------------------
    # ResolvedNode factory
    # ------------------------------------------------------------------

    @staticmethod
    def _make_resolved(node: dict, step: TraceStep, confidence: str) -> ResolvedNode:
        labels = node.get("labels", [])
        node_type = labels[0] if labels else "Unknown"
        file_val = node.get("file", node.get("path", node.get("name", "")))
        line_val = node.get("line_start", node.get("start_line", node.get("line", None)))
        if line_val is not None:
            try:
                line_val = int(line_val)
            except (TypeError, ValueError):
                line_val = None
        return ResolvedNode(
            node_id=str(node.get("_id", node.get("id", ""))),
            node_type=node_type,
            name=str(node.get("name", "")),
            file=str(file_val),
            repo=str(node.get("repo", "")),
            line=line_val,
            visited_at_step=step.step,
            is_root_cause=step.is_root_cause,
            confidence=confidence,
        )

    # ------------------------------------------------------------------
    # Session-level resolution
    # ------------------------------------------------------------------

    def resolve_session(self, session: TraceSession) -> SubgraphResult:
        """Resolve all steps in a session and build the subgraph."""
        resolved: list[ResolvedNode] = []
        ghosts: list[GhostNode] = []

        for step in sorted(session.steps, key=lambda s: s.step):
            result = self.resolve(step)
            if isinstance(result, ResolvedNode):
                resolved.append(result)
            else:
                ghosts.append(result)

        # Build edges between resolved nodes only
        edges = self._build_subgraph_edges(resolved)

        return SubgraphResult(
            resolved=resolved,
            ghosts=ghosts,
            edges=edges,
            workspace=self.workspace,
            session_id=session.session_id,
        )

    def _build_subgraph_edges(self, resolved: list[ResolvedNode]) -> list[dict]:
        """Return graph edges that connect the resolved node set."""
        if len(resolved) < 2:
            return []
        resolved_ids = {r.node_id for r in resolved}
        if not resolved_ids:
            return []

        all_edges = self._fetch_all_edges()
        result: list[dict] = []
        for edge in all_edges:
            src = str(edge.get("source", ""))
            dst = str(edge.get("target", ""))
            if src in resolved_ids and dst in resolved_ids:
                result.append(edge)
        # Add explicit traversal edges between consecutive resolved steps so the
        # UI can always visualize the replay path, even without direct graph edges.
        ordered = sorted(resolved, key=lambda r: r.visited_at_step)
        for i in range(len(ordered) - 1):
            a = ordered[i]
            b = ordered[i + 1]
            if not a.node_id or not b.node_id:
                continue
            result.append(
                {
                    "id": f"trace:{a.visited_at_step}->{b.visited_at_step}",
                    "source": str(a.node_id),
                    "target": str(b.node_id),
                    "type": "TRACE_PATH",
                }
            )
        return result
