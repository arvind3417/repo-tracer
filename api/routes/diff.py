"""Phase 5 — Run Diff: compare two trace sessions and show how AI paths diverged."""

import os
import json
from pathlib import Path
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.models import TraceStep

router = APIRouter()

TRACES_DIR = Path(os.environ.get("TRACES_DIR", "./traces"))


class DiffResponse(BaseModel):
    session_a: str
    session_b: str
    shared_nodes: List[str]
    only_in_a: List[str]
    only_in_b: List[str]
    divergence_step: Optional[int]
    divergence_node_a: Optional[str]
    divergence_node_b: Optional[str]
    steps_a: List[Dict[str, Any]]
    steps_b: List[Dict[str, Any]]
    summary: str


def _load_session_raw(session_id: str) -> dict:
    path = TRACES_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load session '{session_id}': {e}")


def _node_key(step: dict) -> str:
    """Build a canonical node identifier from a step: tool + normalised target."""
    tool = step.get("tool", "")
    target = step.get("target", "")
    # Strip line-range suffixes like :80-130 for comparison purposes
    import re
    target_norm = re.sub(r":\d+(-\d+)?$", "", target)
    return f"{tool}:{target_norm}"


@router.get("/diff", response_model=DiffResponse)
def diff_sessions(
    session_a: str = Query(..., alias="session_a"),
    session_b: str = Query(..., alias="session_b"),
    workspace: Optional[str] = Query(None),
):
    data_a = _load_session_raw(session_a)
    data_b = _load_session_raw(session_b)

    steps_a = sorted(data_a.get("steps", []), key=lambda s: s.get("step", 0))
    steps_b = sorted(data_b.get("steps", []), key=lambda s: s.get("step", 0))

    # Build node key sets
    keys_a = {_node_key(s) for s in steps_a}
    keys_b = {_node_key(s) for s in steps_b}

    shared = sorted(keys_a & keys_b)
    only_a = sorted(keys_a - keys_b)
    only_b = sorted(keys_b - keys_a)

    # Find divergence step — first position where the ordered keys differ
    divergence_step: Optional[int] = None
    divergence_node_a: Optional[str] = None
    divergence_node_b: Optional[str] = None

    seq_a = [_node_key(s) for s in steps_a]
    seq_b = [_node_key(s) for s in steps_b]
    min_len = min(len(seq_a), len(seq_b))

    for i in range(min_len):
        if seq_a[i] != seq_b[i]:
            divergence_step = i + 1  # 1-indexed
            divergence_node_a = steps_a[i].get("target", seq_a[i])
            divergence_node_b = steps_b[i].get("target", seq_b[i])
            break

    if divergence_step is None and len(seq_a) != len(seq_b):
        # Paths were identical up to the shorter one, then diverged
        divergence_step = min_len + 1
        if len(seq_a) > min_len:
            divergence_node_a = steps_a[min_len].get("target", "")
        if len(seq_b) > min_len:
            divergence_node_b = steps_b[min_len].get("target", "")

    # Build summary text
    if divergence_step is None:
        summary = f"Sessions are identical — {len(shared)} shared steps, no divergence."
    else:
        node_a_name = (divergence_node_a or "").split("/")[-1] or divergence_node_a or "?"
        node_b_name = (divergence_node_b or "").split("/")[-1] or divergence_node_b or "?"
        summary = (
            f"Sessions diverged at step {divergence_step}. "
            f"A explored {node_a_name} while B went to {node_b_name}. "
            f"Shared: {len(shared)} nodes. A: {len(only_a)} unique steps. B: {len(only_b)} unique steps."
        )

    return DiffResponse(
        session_a=session_a,
        session_b=session_b,
        shared_nodes=shared,
        only_in_a=only_a,
        only_in_b=only_b,
        divergence_step=divergence_step,
        divergence_node_a=divergence_node_a,
        divergence_node_b=divergence_node_b,
        steps_a=steps_a,
        steps_b=steps_b,
        summary=summary,
    )
