import anthropic
import glob as glob_module
import json
import os
import re
import time
import datetime
from typing import List

from .models import TraceStep, TraceSession
from .phoenix_sink import PhoenixSink

_VERTEX_PROJECT = os.environ.get("ANTHROPIC_VERTEX_PROJECT_ID")
_VERTEX_REGION  = os.environ.get("CLOUD_ML_REGION") or "us-east5"


def _make_client():
    """Return AnthropicVertex if running via Vertex AI, else standard Anthropic client."""
    if os.environ.get("CLAUDE_CODE_USE_VERTEX") == "1" and _VERTEX_PROJECT:
        from anthropic import AnthropicVertex
        import warnings
        warnings.filterwarnings("ignore", message=".*quota project.*")
        return AnthropicVertex(project_id=_VERTEX_PROJECT, region=_VERTEX_REGION)
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    return anthropic.Anthropic(api_key=api_key)


# Model IDs differ between Vertex and direct API
_IS_VERTEX = os.environ.get("CLAUDE_CODE_USE_VERTEX") == "1"
_MODEL_SONNET = "claude-sonnet-4-5" if _IS_VERTEX else "claude-sonnet-4-6"
_MODEL_HAIKU  = "claude-haiku-4-5"  if _IS_VERTEX else "claude-haiku-4-5-20251001"


class TracedClaudeClient:
    """Anthropic SDK wrapper that intercepts every tool call and emits trace events."""

    def __init__(self, api_key: str, sink: PhoenixSink, repo_path: str) -> None:
        self.client = _make_client()
        self.sink = sink
        self.repo_path = os.path.abspath(repo_path)
        self.tools = self._build_tools()

    def _build_tools(self) -> List[dict]:
        """Define read, glob, grep tools Claude can use to navigate the repo."""
        return [
            {
                "name": "read_file",
                "description": "Read a file from the repo",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Relative file path"}
                    },
                    "required": ["path"],
                },
            },
            {
                "name": "glob_files",
                "description": "Find files matching a glob pattern",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Glob pattern like **/*.go",
                        }
                    },
                    "required": ["pattern"],
                },
            },
            {
                "name": "grep_files",
                "description": "Search file contents with a regex pattern",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                        "path": {
                            "type": "string",
                            "description": "Directory or file to search in",
                            "default": ".",
                        },
                    },
                    "required": ["pattern"],
                },
            },
        ]

    def _execute_tool(self, tool_name: str, tool_input: dict) -> str:
        """Execute a tool call and return its string result."""
        base = self.repo_path

        if tool_name == "read_file":
            path = os.path.join(base, tool_input["path"])
            try:
                with open(path) as f:
                    return f.read()
            except Exception as e:
                return f"Error: {e}"

        elif tool_name == "glob_files":
            pattern = os.path.join(base, tool_input["pattern"])
            matches = glob_module.glob(pattern, recursive=True)
            return "\n".join(m.replace(base + "/", "") for m in matches[:50])

        elif tool_name == "grep_files":
            search_path = os.path.join(base, tool_input.get("path", "."))
            pat = tool_input["pattern"]
            results: List[str] = []
            for root, _, files in os.walk(search_path):
                for fname in files:
                    if not fname.endswith(".go"):
                        continue
                    fpath = os.path.join(root, fname)
                    try:
                        with open(fpath) as f:
                            for i, line in enumerate(f, 1):
                                if re.search(pat, line):
                                    rel = fpath.replace(base + "/", "")
                                    results.append(f"{rel}:{i}: {line.rstrip()}")
                    except Exception:
                        pass
            return "\n".join(results[:100]) if results else "No matches"

        return "Unknown tool"

    def _extract_symbols(self, tool_result: str, tool_name: str) -> List[str]:
        """Extract Go symbol names from tool output."""
        symbols: List[str] = []
        if tool_name == "read_file":
            symbols += re.findall(
                r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)",
                tool_result,
                re.MULTILINE,
            )
            symbols += re.findall(r"^type\s+(\w+)", tool_result, re.MULTILINE)
        elif tool_name in ("glob_files", "grep_files"):
            symbols += re.findall(r"(\w+\.go)", tool_result)
        # Deduplicate while preserving order, cap at 10
        seen: dict = {}
        for s in symbols:
            seen[s] = None
        return list(seen.keys())[:10]

    def _get_pre_action_reason(self, tool_name: str, tool_input: dict, query: str) -> str:
        """Ask a fast model to produce a structured reason before executing the tool."""
        try:
            reason_resp = self.client.messages.create(
                model=_MODEL_HAIKU,
                max_tokens=256,
                system=(
                    "You are a reasoning logger. Given a tool call about to be made, "
                    "return ONLY a JSON object with keys: reason (why this tool is being called), "
                    "expected_symbols (list of Go symbol names you expect to find)."
                ),
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Tool: {tool_name}\n"
                            f"Input: {json.dumps(tool_input)}\n"
                            f"Conversation context: {query}"
                        ),
                    }
                ],
            )
            raw = reason_resp.content[0].text.strip()
            # Strip markdown code fences (```json ... ``` or ``` ... ```)
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw.strip())
            reason_data = json.loads(raw)
            return reason_data.get("reason", "")
        except Exception:
            return ""

    def run(self, query: str, session: TraceSession) -> str:
        """Run Claude on the query, tracing every tool call."""
        messages: List[dict] = [{"role": "user", "content": query}]
        step = 0

        while True:
            response = self.client.messages.create(
                model=_MODEL_SONNET,
                max_tokens=4096,
                tools=self.tools,
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                for block in response.content:
                    if hasattr(block, "text"):
                        return block.text
                return ""

            if response.stop_reason == "tool_use":
                tool_results = []
                for block in response.content:
                    if block.type != "tool_use":
                        continue

                    step += 1
                    t_start = time.time()

                    # Obtain structured reasoning before executing the tool
                    reason = self._get_pre_action_reason(block.name, block.input, query)

                    # Execute the actual tool
                    result = self._execute_tool(block.name, block.input)
                    duration_ms = int((time.time() - t_start) * 1000)
                    symbols = self._extract_symbols(result, block.name)

                    trace_step = TraceStep(
                        session_id=session.session_id,
                        step=step,
                        tool=block.name,
                        target=str(
                            block.input.get("path")
                            or block.input.get("pattern")
                            or ""
                        ),
                        reason=reason,
                        symbols_found=symbols,
                        duration_ms=duration_ms,
                        timestamp=datetime.datetime.utcnow(),
                        repo=self.repo_path.split("/")[-1],
                    )
                    session.steps.append(trace_step)
                    self.sink.emit_step(trace_step)

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        }
                    )

                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": tool_results})
