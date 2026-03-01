"""Phase 5 — Session Search: search past trace sessions by keyword, file, or function name."""

import os
import json
from pathlib import Path
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter()

TRACES_DIR = Path(os.environ.get("TRACES_DIR", "./traces"))


class SearchResult(BaseModel):
    session_id: str
    query: str
    repo: str
    started_at: str
    matching_step: Optional[int]
    matching_field: Optional[str]
    match_excerpt: Optional[str]


def _search_step(step: dict, q: str) -> Optional[tuple[str, str]]:
    """
    Return (field_name, excerpt) if q is found in this step, else None.
    Checks: target, symbols_found, reason, next_decision.
    """
    q_lower = q.lower()

    for field in ("target",):
        val = step.get(field, "") or ""
        if q_lower in val.lower():
            return field, val[:120]

    symbols = step.get("symbols_found", []) or []
    for sym in symbols:
        if q_lower in sym.lower():
            return "symbols_found", sym[:120]

    for field in ("reason", "next_decision"):
        val = step.get(field, "") or ""
        if q_lower in val.lower():
            idx = val.lower().find(q_lower)
            start = max(0, idx - 30)
            end = min(len(val), idx + len(q) + 30)
            excerpt = ("..." if start > 0 else "") + val[start:end] + ("..." if end < len(val) else "")
            return field, excerpt

    return None


@router.get("/search", response_model=List[SearchResult])
def search_sessions(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
):
    if not TRACES_DIR.exists():
        return []

    results: List[SearchResult] = []
    q_lower = q.lower()

    for path in TRACES_DIR.glob("*.json"):
        try:
            with open(path, "r") as f:
                data = json.load(f)
        except Exception:
            continue

        session_id = data.get("session_id", path.stem)
        session_query = data.get("query", "") or ""
        repo = data.get("repo", "") or ""
        started_at = data.get("started_at", "") or ""
        steps = data.get("steps", []) or []

        # Check if query text itself matches
        if q_lower in session_query.lower():
            results.append(SearchResult(
                session_id=session_id,
                query=session_query,
                repo=repo,
                started_at=started_at,
                matching_step=None,
                matching_field="query",
                match_excerpt=session_query[:120],
            ))
            continue

        # Search each step
        matched = False
        for step in sorted(steps, key=lambda s: s.get("step", 0)):
            hit = _search_step(step, q)
            if hit:
                field, excerpt = hit
                results.append(SearchResult(
                    session_id=session_id,
                    query=session_query,
                    repo=repo,
                    started_at=started_at,
                    matching_step=step.get("step"),
                    matching_field=field,
                    match_excerpt=excerpt,
                ))
                matched = True
                break  # one result per session

        if not matched and q_lower in repo.lower():
            results.append(SearchResult(
                session_id=session_id,
                query=session_query,
                repo=repo,
                started_at=started_at,
                matching_step=None,
                matching_field="repo",
                match_excerpt=repo,
            ))

    # Sort by started_at descending
    results.sort(key=lambda r: r.started_at, reverse=True)
    return results[:limit]
