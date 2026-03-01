from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
import uuid


class PreActionReason(BaseModel):
    reason: str
    tool: str
    target: str
    expected_symbols: List[str] = []


class TraceStep(BaseModel):
    session_id: str
    step: int
    tool: str
    target: str
    reason: str
    symbols_found: List[str] = []
    next_decision: Optional[str] = None
    duration_ms: int
    timestamp: datetime
    is_root_cause: bool = False
    repo: Optional[str] = None


class TraceSession(BaseModel):
    session_id: str
    query: str
    repo: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    steps: List[TraceStep] = []
    total_steps: int = 0
