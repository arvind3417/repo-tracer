"""
repo-tracer Phase 2 — AI traversal tracer.

Wraps Claude tool calls and emits structured trace events to OTLP sinks via OpenTelemetry.
"""

from .models import PreActionReason, TraceStep, TraceSession
from .phoenix_sink import PhoenixSink, setup_langfuse, setup_phoenix
from .claude_client import TracedClaudeClient

__all__ = [
    "PreActionReason",
    "TraceStep",
    "TraceSession",
    "PhoenixSink",
    "setup_langfuse",
    "setup_phoenix",
    "TracedClaudeClient",
]
