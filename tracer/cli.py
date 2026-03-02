"""
CLI entry point for repo-tracer Phase 2.

Usage:
    python -m tracer.cli trace "<query>" --repo <path> [--phoenix <endpoint>]
"""

import argparse
import datetime
import json
import os
import sys
import uuid

from dotenv import load_dotenv

from .models import TraceSession
from .phoenix_sink import PhoenixSink, setup_phoenix
from .claude_client import TracedClaudeClient


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="tracer.cli",
        description="AI traversal tracer — wraps Claude tool calls and emits Phoenix traces.",
    )
    sub = parser.add_subparsers(dest="command")

    trace_cmd = sub.add_parser("trace", help="Trace a question against a repo")
    trace_cmd.add_argument("query", help="Natural-language question about the repo")
    trace_cmd.add_argument("--repo", required=True, help="Path to the Go repo to analyse")
    trace_cmd.add_argument(
        "--phoenix",
        default=os.environ.get("PHOENIX_ENDPOINT", "http://localhost:4318/v1/traces"),
        help="OTLP HTTP endpoint for Phoenix (default: http://localhost:4318/v1/traces)",
    )

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    load_dotenv()

    args = _parse_args(argv)

    if args.command != "trace":
        print("Usage: python -m tracer.cli trace \"<query>\" --repo <path>", file=sys.stderr)
        sys.exit(1)

    # Support both direct API key and Vertex AI (CLAUDE_CODE_USE_VERTEX=1)
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    using_vertex = os.environ.get("CLAUDE_CODE_USE_VERTEX") == "1"
    if not api_key and not using_vertex:
        print("Error: set ANTHROPIC_API_KEY or CLAUDE_CODE_USE_VERTEX=1", file=sys.stderr)
        sys.exit(1)

    repo_path = os.path.abspath(args.repo)
    if not os.path.isdir(repo_path):
        print(f"Error: repo path does not exist: {repo_path}", file=sys.stderr)
        sys.exit(1)

    session_id = str(uuid.uuid4())
    session = TraceSession(
        session_id=session_id,
        query=args.query,
        repo=repo_path,
        started_at=datetime.datetime.utcnow(),
    )

    # Set up Phoenix OpenTelemetry sink
    tracer = setup_phoenix(endpoint=args.phoenix)
    sink = PhoenixSink(tracer=tracer)
    sink.start_session(session_id=session_id, query=args.query, repo=repo_path)

    # Run the traced Claude client
    client = TracedClaudeClient(api_key=api_key, sink=sink, repo_path=repo_path)
    try:
        answer = client.run(query=args.query, session=session)
    finally:
        session.completed_at = datetime.datetime.utcnow()
        session.total_steps = len(session.steps)
        sink.end_session(session_id)

    # Print the answer
    print("\n" + "=" * 60)
    print(answer)
    print("=" * 60)
    print(f"\nSession ID: {session_id} — view at http://localhost:6006")

    # Persist the session JSON
    traces_dir = os.path.join(os.getcwd(), "traces")
    os.makedirs(traces_dir, exist_ok=True)
    trace_path = os.path.join(traces_dir, f"{session_id}.json")
    with open(trace_path, "w") as f:
        json.dump(session.model_dump(mode="json"), f, indent=2, default=str)
    print(f"Trace saved to: {trace_path}")


if __name__ == "__main__":
    main()
