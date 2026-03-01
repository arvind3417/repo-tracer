"""Phase 5 — Stats Panel: aggregate statistics across all trace sessions."""

import os
import json
from pathlib import Path
from collections import Counter
from typing import List, Dict, Any

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

TRACES_DIR = Path(os.environ.get("TRACES_DIR", "./traces"))


class FileVisit(BaseModel):
    file: str
    visit_count: int


class FunctionVisit(BaseModel):
    name: str
    visit_count: int


class StatsResponse(BaseModel):
    total_sessions: int
    avg_steps_to_answer: float
    most_visited_files: List[FileVisit]
    most_visited_functions: List[FunctionVisit]
    tool_usage: Dict[str, int]
    root_causes_found: int
    repos_explored: List[str]


def _is_file_path(sym: str) -> bool:
    """Heuristic: symbol looks like a file path if it contains '.' with common extension or '/'."""
    import re
    return bool(re.search(r"\.(go|py|ts|tsx|js|jsx|java|rb|rs|cpp|c|h|cs|kt|swift)$", sym, re.IGNORECASE))


def _is_function_name(sym: str) -> bool:
    """Heuristic: symbol looks like a function/method name — no slashes, has camelCase or underscores."""
    import re
    # Skip things that look like file paths or line references
    if "/" in sym or sym.endswith((".go", ".py", ".ts", ".tsx", ".js")):
        return False
    # Must look like an identifier (letters, digits, underscores, dots allowed for pkg.Func)
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_.]*$", sym.split(" in ")[0].strip()))


@router.get("/stats", response_model=StatsResponse)
def get_stats():
    if not TRACES_DIR.exists():
        return StatsResponse(
            total_sessions=0,
            avg_steps_to_answer=0.0,
            most_visited_files=[],
            most_visited_functions=[],
            tool_usage={},
            root_causes_found=0,
            repos_explored=[],
        )

    total_sessions = 0
    total_steps = 0
    root_causes_found = 0
    file_counter: Counter = Counter()
    function_counter: Counter = Counter()
    tool_counter: Counter = Counter()
    repos: set = set()

    for path in TRACES_DIR.glob("*.json"):
        try:
            with open(path, "r") as f:
                data = json.load(f)
        except Exception:
            continue

        total_sessions += 1
        steps = data.get("steps", []) or []
        total_steps += len(steps)

        repo = data.get("repo", "")
        if repo:
            repos.add(repo)

        for step in steps:
            tool = step.get("tool", "unknown") or "unknown"
            tool_counter[tool] += 1

            if step.get("is_root_cause", False):
                root_causes_found += 1

            # Accumulate file and function visits from target and symbols_found
            target = step.get("target", "") or ""
            if target:
                # Extract file name from targets like "path/to/file.go:80-130"
                import re
                file_match = re.match(r"^(.+\.(go|py|ts|tsx|js|jsx|java|rb|rs|cpp|c|h|cs|kt|swift))", target, re.IGNORECASE)
                if file_match:
                    fname = file_match.group(1).split("/")[-1]
                    file_counter[fname] += 1

            for sym in (step.get("symbols_found", []) or []):
                clean_sym = sym.split(" in ")[0].strip()
                if _is_file_path(clean_sym):
                    fname = clean_sym.split("/")[-1]
                    file_counter[fname] += 1
                elif _is_function_name(clean_sym) and len(clean_sym) > 1:
                    function_counter[clean_sym] += 1

    avg_steps = round(total_steps / total_sessions, 2) if total_sessions > 0 else 0.0

    most_visited_files = [
        FileVisit(file=f, visit_count=c)
        for f, c in file_counter.most_common(10)
    ]
    most_visited_functions = [
        FunctionVisit(name=fn, visit_count=c)
        for fn, c in function_counter.most_common(10)
    ]

    return StatsResponse(
        total_sessions=total_sessions,
        avg_steps_to_answer=avg_steps,
        most_visited_files=most_visited_files,
        most_visited_functions=most_visited_functions,
        tool_usage=dict(tool_counter),
        root_causes_found=root_causes_found,
        repos_explored=sorted(repos),
    )
