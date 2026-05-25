"""Shared helpers for the big_eval build scripts (imported by sibling scripts when
run directly via `uv run .../<script>.py`)."""
import re


def dedup_sig(text: str) -> frozenset:
    """Near-duplicate signature: the 5 longest distinct words. Two notes sharing a
    signature are treated as the same viral-event near-duplicate."""
    words = sorted({w.lower() for w in re.findall(r"[A-Za-z]{5,}", text or "")}, key=len, reverse=True)[:5]
    return frozenset(words)
