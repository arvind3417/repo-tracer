"""Graph API endpoints — Phase 4."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.falkordb_client import FalkorDBClient
from api.resolver import NodeResolver, ResolvedNode, GhostNode, SubgraphResult
from api.models import TraceSession

logger = logging.getLogger(__name__)

router = APIRouter()

TRACES_DIR = Path(os.environ.get("TRACES_DIR", "./traces"))


def _get_client() -> FalkorDBClient:
    return FalkorDBClient()


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _load_session(session_id: str) -> TraceSession:
    path = TRACES_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    import json
    with open(path) as f:
        data = json.load(f)
    return TraceSession(**data)


def _node_to_dict(node: dict) -> dict:
    """Normalise a raw FalkorDB node dict for the API response."""
    labels = node.get("labels", [])
    node_type = labels[0] if labels else "Unknown"
    # _id is our internal FalkorDB node id (from id(n) projection)
    node_id = node.get("_id", node.get("id", ""))
    return {
        "id": str(node_id),
        "label": str(node.get("name", "")),
        "type": node_type,
        "name": str(node.get("name", "")),
        "repo": str(node.get("repo", "")),
        "file": str(node.get("file", node.get("path", ""))),
        "line": node.get("line_start", node.get("line")),
        **{k: v for k, v in node.items() if k not in ("_id", "id", "labels")},
    }


def _edge_to_dict(edge: dict) -> dict:
    """Normalise a raw FalkorDB edge dict for the API response."""
    return {
        "id": str(edge.get("id", "")),
        "source": str(edge.get("source", "")),
        "target": str(edge.get("target", "")),
        "type": str(edge.get("type", "")),
        "confidence": str(edge.get("confidence", "1.0")),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/graph/workspaces")
def list_workspaces():
    """List all workspaces (FalkorDB graph names) with basic stats."""
    client = _get_client()
    if not client.is_available():
        return {"workspaces": [], "warning": "FalkorDB is not reachable"}

    graph_names = client.list_graphs()
    result = []
    for name in graph_names:
        try:
            stats = client.graph_stats(name)
            # Count repos: distinct 'repo' property on nodes
            repo_rows = client.query(
                name,
                "MATCH (n) WHERE n.repo IS NOT NULL RETURN DISTINCT n.repo AS repo",
            )
            repo_count = len(repo_rows)
            result.append(
                {
                    "workspace": name,
                    "repo_count": repo_count,
                    "node_count": stats.get("node_count", 0),
                }
            )
        except Exception as exc:
            logger.warning("Failed to get stats for graph '%s': %s", name, exc)
            result.append({"workspace": name, "repo_count": 0, "node_count": 0})

    return {"workspaces": result}


@router.get("/graph/{workspace}/nodes")
def get_nodes(workspace: str, type: Optional[str] = Query(None)):
    """Return all nodes in a workspace graph.

    Optional ?type=Function,File filter (comma-separated).
    """
    client = _get_client()
    if not client.is_available():
        return {"nodes": [], "warning": "FalkorDB is not reachable"}

    # Use NodeResolver's _fetch_all_nodes which uses safe property projections
    from api.resolver import NodeResolver
    resolver = NodeResolver(client, workspace)
    all_nodes = resolver._all_nodes()

    if type:
        filter_labels = {t.strip() for t in type.split(",") if t.strip()}
        all_nodes = [n for n in all_nodes if set(n.get("labels", [])) & filter_labels]

    nodes = [_node_to_dict(n) for n in all_nodes]
    return {"nodes": nodes}


@router.get("/graph/{workspace}/edges")
def get_edges(workspace: str):
    """Return all edges in a workspace graph."""
    client = _get_client()
    if not client.is_available():
        return {"edges": [], "warning": "FalkorDB is not reachable"}

    rows = client.query(workspace, "MATCH ()-[r]->() RETURN r")
    edges = []
    for row in rows:
        e = row.get("r")
        if isinstance(e, dict):
            edges.append(_edge_to_dict(e))

    return {"edges": edges}


@router.get("/graph/{workspace}/subgraph")
def get_subgraph(workspace: str, session_id: str = Query(...)):
    """Resolve a trace session's steps to FalkorDB node IDs and return the subgraph.

    Each resolved node includes visited_at_step and is_root_cause.
    Unresolved steps appear as ghost nodes.
    """
    client = _get_client()
    session = _load_session(session_id)

    if not client.is_available():
        # Return all steps as ghosts when FalkorDB is offline
        ghosts = []
        for step in session.steps:
            ghosts.append(
                {
                    "target": step.target,
                    "tool": step.tool,
                    "visited_at_step": step.step,
                    "is_root_cause": step.is_root_cause,
                    "reason": "falkordb-offline",
                }
            )
        return {
            "resolved": [],
            "ghosts": ghosts,
            "edges": [],
            "workspace": workspace,
            "session_id": session_id,
            "warning": "FalkorDB is not reachable",
        }

    resolver = NodeResolver(client, workspace)
    result: SubgraphResult = resolver.resolve_session(session)

    resolved_out = []
    for r in result.resolved:
        resolved_out.append(
            {
                "node_id": r.node_id,
                "node_type": r.node_type,
                "name": r.name,
                "file": r.file,
                "repo": r.repo,
                "line": r.line,
                "visited_at_step": r.visited_at_step,
                "is_root_cause": r.is_root_cause,
                "confidence": r.confidence,
            }
        )

    ghost_out = []
    for g in result.ghosts:
        ghost_out.append(
            {
                "target": g.target,
                "tool": g.tool,
                "visited_at_step": g.visited_at_step,
                "is_root_cause": g.is_root_cause,
                "reason": g.reason,
            }
        )

    return {
        "resolved": resolved_out,
        "ghosts": ghost_out,
        "edges": [_edge_to_dict(e) for e in result.edges],
        "workspace": workspace,
        "session_id": session_id,
    }


@router.get("/graph/{workspace}/node/{node_id}")
def get_node(workspace: str, node_id: str):
    """Return full details for a single node by its FalkorDB node ID."""
    client = _get_client()
    if not client.is_available():
        raise HTTPException(status_code=503, detail="FalkorDB is not reachable")

    rows = client.query(
        workspace,
        f"MATCH (n) WHERE id(n) = {node_id} RETURN n",
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found in workspace '{workspace}'")

    n = rows[0].get("n")
    if not isinstance(n, dict):
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    return _node_to_dict(n)
