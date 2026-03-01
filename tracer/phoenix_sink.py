from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from openinference.instrumentation.anthropic import AnthropicInstrumentor
from typing import Dict, Optional
from .models import TraceStep


def setup_phoenix(endpoint: str = "http://localhost:4318/v1/traces") -> trace.Tracer:
    """Configure OpenTelemetry to export traces to Phoenix and return a tracer."""
    provider = TracerProvider()
    exporter = OTLPSpanExporter(endpoint=endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    AnthropicInstrumentor().instrument()
    return trace.get_tracer("repo-tracer")


class PhoenixSink:
    """Emits structured trace events to Phoenix via OpenTelemetry spans."""

    def __init__(self, tracer: trace.Tracer) -> None:
        self.tracer = tracer
        # Maps session_id -> (root span, span context manager)
        self._sessions: Dict[str, Dict] = {}

    def start_session(self, session_id: str, query: str, repo: str) -> None:
        """Start a root span for the given session."""
        span_cm = self.tracer.start_as_current_span(
            f"repo-tracer.session.{session_id}"
        )
        span = span_cm.__enter__()
        span.set_attribute("session_id", session_id)
        span.set_attribute("query", query)
        span.set_attribute("repo", repo)
        self._sessions[session_id] = {
            "span": span,
            "span_cm": span_cm,
        }

    def emit_step(self, step: TraceStep) -> None:
        """Create a child span for a single trace step."""
        with self.tracer.start_as_current_span(
            f"repo-tracer.step.{step.tool}"
        ) as span:
            span.set_attribute("session_id", step.session_id)
            span.set_attribute("step", step.step)
            span.set_attribute("tool", step.tool)
            span.set_attribute("target", step.target)
            span.set_attribute("reason", step.reason)
            span.set_attribute("symbols_found", ",".join(step.symbols_found))
            span.set_attribute("duration_ms", step.duration_ms)
            span.set_attribute("timestamp", step.timestamp.isoformat())
            span.set_attribute("is_root_cause", step.is_root_cause)
            if step.next_decision is not None:
                span.set_attribute("next_decision", step.next_decision)
            if step.repo is not None:
                span.set_attribute("repo", step.repo)

    def end_session(self, session_id: str) -> None:
        """End the root span for the given session."""
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        span_cm: object = session["span_cm"]
        span_cm.__exit__(None, None, None)
