# Where Claude Code's time goes (GOO-502)

Findings page: https://claude.ai/artifact/K15EBkjgdKRGtFBFhqXbi9

These scripts read the Claude Code session transcripts in `~/.claude/projects` on the devbox and split each session's busy time into model time and tool time. The transcripts themselves stay on the devbox.

Every script except `timeit.py` takes `--since` and `--until` as UTC dates (the end is exclusive), for example `--since 2026-10-26 --until 2026-11-02` for one week. Without them they measure the first audit's period, 12 to 26 October. `window.py` holds that shared logic. The weekly standing job (GOO-609) runs them every Sunday.

- `analyze2.py <dir-prefix>...` gives the busy-time split per repo, for example `python3 analyze2.py cn-return-bot ai-browser-blocker`. It is the main script.
- `analyze.py` holds the shell command categories that `analyze2.py` imports. Run on its own, it prints per-category call counts, means and the slowest calls.
- `latency.py` relates reply time to context size and output tokens.
- `output.py` splits output tokens into tool calls, edits and final replies.
- `commits.py` looks at how commits fail and what Claude does next.
- `ghcmds.py` times the gh, git fetch, ssh and sleep commands.
- `edits.py <dir-prefix>...` relates each session's model time to the lines and files Claude edited.
- `timeit.py check_timings.txt` times each step of the commit hook one after another. Replace `$SCRATCH` with a writable folder first.
