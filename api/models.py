from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class TraceStep(BaseModel):
    session_id: str
    step: int
    tool: str
    target: str
    reason: str
    symbols_found: List[str]
    next_decision: Optional[str] = None
    duration_ms: int
    timestamp: str
    is_root_cause: bool
    repo: Optional[str] = None


class TraceSession(BaseModel):
    session_id: str
    query: str
    repo: str
    started_at: str
    completed_at: Optional[str] = None
    total_steps: int
    steps: List[TraceStep]


class SessionSummary(BaseModel):
    session_id: str
    query: str
    repo: str
    started_at: str
    total_steps: int
