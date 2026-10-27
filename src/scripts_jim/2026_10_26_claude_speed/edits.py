"""Does model time grow with the size of the change?

For every session with at least one file edit, this counts the lines Claude wrote
(the new text of each Edit and Write call), the distinct files it edited, and the
session's model time. It then fits model time against lines written, with an
ordinary least-squares line, and prints how much model time one more written
line costs on average.
"""
import json, sys, statistics as st
from analyze2 import intervals, busy_split, clip
from window import parse_window, transcripts, in_window

EDIT_TOOLS = ("Edit", "Write", "MultiEdit")
MIN_LINES = 1


def edit_size(path, since, until):
    """Lines written and distinct files edited by the main thread inside the period."""
    lines, files = 0, set()
    for raw in open(path):
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if d.get("isSidechain") or d.get("type") != "assistant" or not in_window(d, since, until):
            continue
        for block in d["message"].get("content") or []:
            if block.get("type") != "tool_use" or block["name"] not in EDIT_TOOLS:
                continue
            inp = block.get("input", {})
            texts = [inp.get("new_string", ""), inp.get("content", "")] + [e.get("new_string", "") for e in inp.get("edits", [])]
            lines += sum(t.count("\n") + 1 for t in texts if t)
            files.add(inp.get("file_path"))
    return lines, len(files)


def fit(xs, ys):
    """Slope and intercept of the least-squares line, and the correlation."""
    mx, my = st.mean(xs), st.mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sxy / sxx
    return slope, my - slope * mx, st.correlation(xs, ys)


def main():
    since, until, patterns = parse_window(sys.argv[1:])
    rows = []
    for pattern in patterns:
        for f in transcripts(pattern, since):
            lines, files = edit_size(f, since, until)
            if lines < MIN_LINES:
                continue
            model, tools, _ = (clip(i, since, until) for i in intervals(f))
            split = busy_split(model, tools)
            if not split["model"]:
                # Older Claude Code versions logged no request lines, so their model time is unknown.
                continue
            rows.append((pattern, f.rsplit("/", 2)[1], lines, files, split["model"], sum(split.values())))
    for pattern in patterns:
        rs = [r for r in rows if r[0] == pattern]
        if len(rs) < 3:
            continue
        slope, intercept, r = fit([x[2] for x in rs], [x[4] for x in rs])
        fslope, _, fr = fit([x[3] for x in rs], [x[4] for x in rs])
        print(f"=== {pattern}: {len(rs)} sessions with edits")
        print(f"  model time = {intercept/60:.1f} min + {slope:.1f} s per written line (correlation {r:.2f})")
        print(f"  per edited file: {fslope/60:.1f} min of model time (correlation {fr:.2f})")
        ratios = [x[4] / x[2] for x in rs]
        print(f"  per session, model seconds per written line: median {st.median(ratios):.1f}, middle half {st.quantiles(ratios, n=4)[0]:.1f} to {st.quantiles(ratios, n=4)[2]:.1f}")
        largest = max(rs, key=lambda x: x[2])
        rest = [x for x in rs if x is not largest]
        rslope, rintercept, rr = fit([x[2] for x in rest], [x[4] for x in rest])
        print(f"  without the largest session ({largest[2]} lines): {rintercept/60:.1f} min + {rslope:.1f} s per line (correlation {rr:.2f})")
        print(f"  lines written: median {st.median(x[2] for x in rs):.0f}, total {sum(x[2] for x in rs)}; model time total {sum(x[4] for x in rs)/3600:.1f} h")
    print(f"\n{'repo':20} {'session folder':60} {'lines':>6} {'files':>5} {'model min':>9} {'busy min':>8}")
    for row in sorted(rows, key=lambda x: -x[2])[:40]:
        print(f"{row[0]:20} {row[1][-60:]:60} {row[2]:6} {row[3]:5} {row[4]/60:9.1f} {row[5]/60:8.1f}")


if __name__ == "__main__":
    main()
