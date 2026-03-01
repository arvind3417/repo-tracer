import os
import json
import uuid
from pathlib import Path
from typing import List
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from api.models import TraceSession, TraceStep, SessionSummary

router = APIRouter()

TRACES_DIR = Path(os.environ.get("TRACES_DIR", "./traces"))


def _load_session(path: Path) -> TraceSession:
    with open(path, "r") as f:
        data = json.load(f)
    return TraceSession(**data)


def _list_sessions() -> List[TraceSession]:
    if not TRACES_DIR.exists():
        return []
    sessions = []
    for p in TRACES_DIR.glob("*.json"):
        try:
            sessions.append(_load_session(p))
        except Exception:
            continue
    return sessions


@router.get("/traces", response_model=List[SessionSummary])
def list_traces():
    sessions = _list_sessions()
    sessions.sort(key=lambda s: s.started_at, reverse=True)
    return [
        SessionSummary(
            session_id=s.session_id,
            query=s.query,
            repo=s.repo,
            started_at=s.started_at,
            total_steps=s.total_steps,
        )
        for s in sessions
    ]


@router.get("/traces/{session_id}", response_model=TraceSession)
def get_trace(session_id: str):
    path = TRACES_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    try:
        return _load_session(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/traces/{session_id}/steps", response_model=List[TraceStep])
def get_steps(session_id: str):
    path = TRACES_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    try:
        session = _load_session(path)
        return sorted(session.steps, key=lambda s: s.step)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/traces/mock", response_model=TraceSession)
def create_mock_trace():
    session_id = str(uuid.uuid4())
    now = "2026-03-01T10:00:00Z"

    steps = [
        TraceStep(
            session_id=session_id,
            step=1,
            tool="glob_files",
            target="internal/settlement/**",
            reason="settlement is the domain — start here to find the relevant files",
            symbols_found=["settlement_cron.go", "settlement_service.go", "settlement_repo.go"],
            next_decision="read the cron file next — it is the entry point for scheduled runs",
            duration_ms=210,
            timestamp="2026-03-01T10:00:05Z",
            is_root_cause=False,
            repo="my-go-repo",
        ),
        TraceStep(
            session_id=session_id,
            step=2,
            tool="read_file",
            target="internal/settlement/settlement_cron.go",
            reason="cron is the entry point — understand how the settlement job is triggered",
            symbols_found=["RunSettlementCron", "SettlementScheduler", "processBatch"],
            next_decision="grep for processBatch — it processes the actual settlement records",
            duration_ms=145,
            timestamp="2026-03-01T10:00:08Z",
            is_root_cause=False,
            repo="my-go-repo",
        ),
        TraceStep(
            session_id=session_id,
            step=3,
            tool="grep_symbol",
            target="processBatch",
            reason="processBatch is the core logic — find all call sites and its implementation",
            symbols_found=["processBatch in settlement_service.go:87", "processBatch in settlement_cron.go:45"],
            next_decision="read settlement_service.go around line 87 — that is where delays could originate",
            duration_ms=320,
            timestamp="2026-03-01T10:00:12Z",
            is_root_cause=False,
            repo="my-go-repo",
        ),
        TraceStep(
            session_id=session_id,
            step=4,
            tool="read_file",
            target="internal/settlement/settlement_service.go:80-130",
            reason="read the processBatch implementation to find the delay source",
            symbols_found=["processBatch", "retryWithBackoff", "maxRetries", "sleepDuration"],
            next_decision="retryWithBackoff uses a hardcoded 30s sleep — this is the delay cause",
            duration_ms=98,
            timestamp="2026-03-01T10:00:14Z",
            is_root_cause=False,
            repo="my-go-repo",
        ),
        TraceStep(
            session_id=session_id,
            step=5,
            tool="read_file",
            target="internal/settlement/settlement_service.go:200-240",
            reason="read retryWithBackoff — this is suspected root cause of settlement delays",
            symbols_found=["retryWithBackoff", "time.Sleep(30 * time.Second)", "maxRetries = 10"],
            next_decision=None,
            duration_ms=87,
            timestamp="2026-03-01T10:00:16Z",
            is_root_cause=True,
            repo="my-go-repo",
        ),
    ]

    session = TraceSession(
        session_id=session_id,
        query="why are settlements delayed?",
        repo="my-go-repo",
        started_at=now,
        completed_at="2026-03-01T10:00:17Z",
        total_steps=5,
        steps=steps,
    )

    TRACES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = TRACES_DIR / f"{session_id}.json"
    with open(out_path, "w") as f:
        json.dump(session.model_dump(), f, indent=2)

    return session
