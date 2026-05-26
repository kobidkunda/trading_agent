#!/usr/bin/env python3
"""Prove upstream TradingAgents memory-log pending/resolved/context behavior."""

import json
import subprocess
import textwrap


CONTAINER = "tcc-tradingagents"


def run_in_container() -> dict:
    probe = r"""
import json
import tempfile
from pathlib import Path

from tradingagents.agents.utils.memory import TradingMemoryLog

log_path = Path(tempfile.mkdtemp(prefix="ta-memory-")) / "trading_memory.md"
log = TradingMemoryLog({
    "memory_log_path": str(log_path),
    "memory_log_max_entries": 10,
})

log.store_decision(
    "BTC",
    "2025-01-02",
    "BUY because momentum improved and benchmark-relative demand strengthened.",
)
pending = log.get_pending_entries()

log.update_with_outcome(
    "BTC",
    "2025-01-02",
    raw_return=0.123,
    alpha_return=0.045,
    holding_days=5,
    reflection=(
        "The directional call was correct and alpha was positive. "
        "Momentum held better than the benchmark, so future similar calls "
        "should preserve the benchmark-relative demand check."
    ),
)

entries = log.load_entries()
context = log.get_past_context("BTC")
print(json.dumps({
    "path": str(log_path),
    "pending_before": pending,
    "entries_after": entries,
    "context": context,
}, sort_keys=True))
"""
    completed = subprocess.run(
        ["docker", "exec", CONTAINER, "python", "-c", probe],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    return json.loads(completed.stdout)


def main() -> None:
    try:
        result = run_in_container()
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        detail = "\n".join(part for part in (stdout, stderr) if part)
        raise AssertionError(f"{CONTAINER} memory-log probe failed:\n{detail}") from exc

    pending = result["pending_before"]
    entries = result["entries_after"]
    context = result["context"]

    assert len(pending) == 1, result
    assert pending[0]["ticker"] == "BTC", result
    assert pending[0]["pending"] is True, result
    assert pending[0]["rating"] == "Buy", result

    assert len(entries) == 1, result
    resolved = entries[0]
    assert resolved["pending"] is False, result
    assert resolved["raw"] == "+12.3%", result
    assert resolved["alpha"] == "+4.5%", result
    assert resolved["holding"] == "5d", result
    assert "alpha was positive" in resolved["reflection"], result
    assert "Past analyses of BTC" in context, result
    assert "REFLECTION:" in context, result
    assert "+4.5%" in context, result

    print(
        textwrap.dedent(
            f"""\
            memory log ok: pending entry resolved and injected into past context
            memory_log_path={result['path']}
            """
        ).strip()
    )


if __name__ == "__main__":
    main()
