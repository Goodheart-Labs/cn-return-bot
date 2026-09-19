# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Stitch RESULTS.md from the hand-written top section plus the three generated parts.

The top section above the marker is hand-written and is preserved on every rerun.
Order of operations for a full redo:
    uv run pull.py --force && uv run pull_b.py --force
    uv run run.py && uv run competition.py && uv run posthoc.py && uv run results.py
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
MARKER = "<!-- AUTO-GENERATED BELOW THIS LINE; edits below are overwritten by results.py -->"

rp = HERE / "RESULTS.md"
head = rp.read_text().split(MARKER)[0].rstrip() if rp.exists() and MARKER in rp.read_text() else "# Corpus model\n"
parts = [(DATA / f).read_text().rstrip() for f in ("part_a.md", "part_b.md", "part_c.md")
         if (DATA / f).exists()]
# part_c is the post-hoc appendix to part A; keep it next to A's weight table.
a, b, c = parts[0], parts[1], parts[2] if len(parts) > 2 else ""
rp.write_text(head + "\n\n" + MARKER + "\n\n" + a + "\n\n" + c + "\n\n---\n\n" + b + "\n")
print(f"wrote {rp} ({len(rp.read_text().splitlines())} lines)")
