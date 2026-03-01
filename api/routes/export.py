"""Phase 5 — Export: download trace sessions as JSON, Markdown, or permalink."""

import os
import json
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, JSONResponse

router = APIRouter()

TRACES_DIR = Path(os.environ.get("TRACES_DIR", "./traces"))
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5173")


def _load_session_raw(session_id: str) -> dict:
    path = TRACES_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load session: {e}")


def _format_date(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return iso


def _build_markdown(data: dict) -> str:
    lines = []
    query = data.get("query", "")
    repo = data.get("repo", "")
    started_at = _format_date(data.get("started_at", ""))
    steps = sorted(data.get("steps", []), key=lambda s: s.get("step", 0))
    total_steps = data.get("total_steps", len(steps))

    lines.append(f'# Trace: "{query}"')
    lines.append("")
    lines.append(f"**Repo:** {repo} | **Steps:** {total_steps} | **Date:** {started_at}")
    lines.append("")

    for step in steps:
        step_num = step.get("step", "?")
        tool = step.get("tool", "unknown")
        target = step.get("target", "")
        reason = step.get("reason", "")
        symbols = step.get("symbols_found", [])
        next_dec = step.get("next_decision", "")
        is_root_cause = step.get("is_root_cause", False)

        rc_label = " - ROOT CAUSE" if is_root_cause else ""
        lines.append(f"## Step {step_num} — {tool}{rc_label}")
        lines.append("")
        lines.append(f"**Target:** {target}")
        lines.append("")
        lines.append(f"**Reason:** {reason}")
        if symbols:
            lines.append("")
            lines.append(f"**Found:** {', '.join(symbols)}")
        if next_dec:
            lines.append("")
            lines.append(f"**Next:** {next_dec}")
        lines.append("")

    return "\n".join(lines)


@router.get("/export/{session_id}")
def export_session(
    session_id: str,
    format: str = Query("json", pattern="^(json|markdown|permalink)$"),
    workspace: Optional[str] = Query(None),
):
    data = _load_session_raw(session_id)
    short_id = session_id[:8]

    if format == "json":
        content = json.dumps(data, indent=2)
        return Response(
            content=content,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="trace-{short_id}.json"'
            },
        )

    elif format == "markdown":
        content = _build_markdown(data)
        return Response(
            content=content,
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="trace-{short_id}.md"'
            },
        )

    elif format == "permalink":
        params = f"session={session_id}"
        if workspace:
            params += f"&workspace={workspace}"
        url = f"{APP_BASE_URL}?{params}"
        return JSONResponse({"url": url})

    # Should not reach here due to regex validation
    raise HTTPException(status_code=400, detail=f"Unknown format: {format}")
