"""How often does Claude run checks, relative to its edits and commits?

Walks each session's tool calls in order. For every check run (type check,
full check or a vitest run) it records how many file edits came since the
previous check, and whether the next git action after it is a commit before
any further edit.
"""
import json, re, sys, collections, statistics as st
from window import parse_window, transcripts, in_window

CHECK_KINDS = [
    ("full check", r"npm run check\b(?!:)"),
    ("vitest", r"vitest"),
    ("type check", r"\btsc\b|typescript@"),
]
EDIT_TOOLS = ("Edit", "Write", "MultiEdit")


def check_kind(cmd):
    return next((kind for kind, pattern in CHECK_KINDS if re.search(pattern, cmd)), None)


def events(path, since, until):
    """The session's tool calls in order, as ("edit" | check kind | "commit", command)."""
    for raw in open(path):
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if d.get("isSidechain") or d.get("type") != "assistant" or not in_window(d, since, until):
            continue
        for block in d["message"].get("content") or []:
            if block.get("type") != "tool_use":
                continue
            if block["name"] in EDIT_TOOLS:
                yield "edit", block["input"].get("file_path", "")
            elif block["name"] == "Bash":
                cmd = block["input"].get("command", "")
                kind = check_kind(cmd)
                if kind:
                    yield kind, cmd
                if re.search(r"\bgit (-C \S+ )?commit\b", cmd):
                    yield "commit", cmd


def main():
    since, until, patterns = parse_window(sys.argv[1:])
    for pattern in patterns:
        edits_before = collections.defaultdict(list)
        followed_by_commit = collections.Counter()
        runs = collections.Counter()
        sessions_with_edits = 0
        for f in transcripts(pattern, since):
            seq = list(events(f, since, until))
            sessions_with_edits += any(e[0] == "edit" for e in seq)
            edits_since_check = 0
            for i, (kind, _) in enumerate(seq):
                if kind == "edit":
                    edits_since_check += 1
                    continue
                if kind == "commit":
                    continue
                runs[kind] += 1
                edits_before[kind].append(edits_since_check)
                edits_since_check = 0
                after = next((k for k, _ in seq[i + 1:] if k in ("edit", "commit")), None)
                followed_by_commit[kind] += after == "commit"
        print(f"=== {pattern}: {sessions_with_edits} sessions with edits")
        for kind, n in runs.most_common():
            eb = edits_before[kind]
            print(f"  {kind:11} runs {n:4}  per editing session {n/max(1,sessions_with_edits):4.1f}  "
                  f"edits since the previous check: median {st.median(eb):.0f}, zero in {sum(e == 0 for e in eb)/n:.0%}  "
                  f"next action is a commit: {followed_by_commit[kind]/n:.0%}")


if __name__ == "__main__":
    main()
