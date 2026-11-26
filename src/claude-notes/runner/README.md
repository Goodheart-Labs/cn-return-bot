# The Claude note writer's runner (GOO-580, GOO-787, GOO-876)

The runner writes Jim's Claude notes as the notewriter `claude-ai-box`. It runs
on Jim's notewriter account, a Claude Code subscription used for nothing else
(GOO-787, 2026-11-19). It runs on the devbox since 2026-11-25 (GOO-876). Until
then it ran on Nathan's ai-box, which gave the notewriter its name. The same
code runs on Nathan's hq as `claude-hq-nathan`, for posts only.

A runner starts one headless Claude (`claude -p`) per job, each in its own
tmux session so a person can attach and watch. A scheduler
(`src/claude-notes/runner/scheduler.ts`) does what is the same for every job:
free slots, the budget gate, the deploy freeze, time limits, alerts and cost
rows. One module per kind in `src/claude-notes/jobs/` says which work is
waiting, how to prepare one job and how to close it:

| Job | tmux session | At once |
|---|---|---|
| A Common Notes post from the post list | `cn-post-<item>` | 5 |
| An X tweet the X run handed to Claude (GOO-527) | `cn-x-<run id>` | 6 |
| A reviewer's message on the review page | `cn-msg-<draft>` | 3 |
| A creator whose X account nobody looked up | `cn-xacct-<slug>` | 1 |
| A posted note to judge, isolated from the runner's keys | `cn-judge-<draft>` | 1 |

A post whose Claude exits twice without a report fails its reservation, and
the post stays listed for the other notewriters. Nothing goes to the
pipeline. Before a post's or a tweet's Claude starts, every image it links to
goes through the image screen (`src/claude-notes/imageScreen.ts`, GOO-815).

## Where it runs

The devbox's unit files and scripts live in Jim's devbox repository, in
`cn-notes-runner/`, whose README lists every path. In short:

| Path on the devbox | What it is |
|---|---|
| `~/dev/repos/cn-return-bot--devbox-runner` | A checkout of main that only the deploy timer moves. It has no `.env` file on purpose: Bun would load it into every Claude, and the devbox one holds the paid API key, which Claude would use instead of the notewriter login. |
| `~/.claude-cn-notewriter` | The config folder of Jim's notewriter account: its login in `.credentials.json` and Claude Code's own files. The unit points Claude Code here with `CLAUDE_CONFIG_DIR`. |
| `~/.config/cn-notes/env` | The secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `EXTRACTION_URL`, `SERVICE_AUTH_SECRET`, `CN_NOTEWRITER_KEY` (the notewriter API v2 key of `claude-ai-box`, made with `bun run notewriter new-key claude-ai-box`), `SLACK_BOT_TOKEN` (the alerts), `XAI_API_KEY` (Grok, which the X handle lookups ask), `OPENAI_API_KEY`, and `ARACHNID_SHIELD_USERNAME` and `ARACHNID_SHIELD_PASSWORD` (the image screen). The runner removes all but the database keys from its Claudes' environment. |
| `/var/tmp/cn-notes-devbox/<kind>/<key>/` | One run folder per job, the same for every try: the prompt, the start script, Claude Code's output, stderr and the exit code, plus what the job keeps (a post's drafts and `report.json`, a tweet's `note.json`). The runner deletes folders older than 3 days. |
| `~/.local/share/cn-notes/note-examples.md` | The examples file, rebuilt once a day by the runner. |
| `~/.local/share/cn-notes/PAUSE` | The pause switch. While it exists, the runner starts nothing. |
| `~/.local/share/cn-notes/draining` | The deploy's freeze. While it exists, the runner starts nothing, so the deploy can restart it once the Claudes at work have finished. |

## Logging in to the notewriter account

Use a normal Claude Code login, not `claude setup-token`. A normal login keeps
an access token and a refresh token in `.credentials.json`, and Claude Code
renews the access token by itself. The runner reads the plan's usage with that
access token, and when it has expired the runner renews it with a tiny Haiku
call. A `setup-token` token is meant for running models only and cannot be
trusted to read the usage endpoint, which the pacing and the X share need.

Sign in from a private browser window that is logged in to claude.ai as the
notewriter account, or the link may log you into another account.

```bash
mkdir -m 700 ~/.claude-cn-notewriter            # only the first time
CLAUDE_CONFIG_DIR=~/.claude-cn-notewriter claude auth login
# Choose the Claude subscription, open the link, sign in, paste the code back.
CLAUDE_CONFIG_DIR=~/.claude-cn-notewriter claude auth status
```

`auth status` should name the notewriter account and its plan. If
`claude auth login` is unknown, run `claude update` first.

## Alerts

The runner tells the Claude notes channel in Slack when its login no longer
works, when it could not read the usage for 30 minutes, when 3 Claude jobs in
a row failed, and when the image screen stopped a job (`src/claude-notes/alerts.ts`).
Each problem is posted once when it starts and once when it clears. A runner
that stopped altogether is noticed by cn-walk's silence watch after 30
minutes.

## Setting it up

The devbox repository's `install.sh` links the units and starts the runner
once `~/.config/cn-notes/env` exists. The checkout is made once with
`git clone https://github.com/Goodheart-Labs/cn-return-bot.git ~/dev/repos/cn-return-bot--devbox-runner`
and `bun install --frozen-lockfile` in it. Then log in to the notewriter
account as above.

## Day to day

- `journalctl --user -u cn-notes-runner -f` shows what the runner starts and ends.
- `TMUX_TMPDIR=~/.local/share/cn-notes/tmux tmux attach -t cn-post-<first 8 characters of the item id>` shows a Claude at work. The runner's Claudes run on their own tmux server, so they stay out of Jim's session list.
- A merged PR reaches the runner through a freeze (`journalctl --user -u cn-notes-deploy`). Within 5 minutes the deploy creates the drain file, and the runner stops starting Claudes while new work waits in the database. When the runner reports in `/var/tmp/cn-notes-devbox/runner-state` that nothing is at work any more, the deploy updates the checkout, removes the file and restarts the runner. Nothing is cut off and nothing is lost. A freeze lasts as long as the longest Claude still at work, usually under an hour.
- Every Claude has a time limit. A post's Claude is stopped 10 minutes before its reservation ends, a tweet's 10 minutes before the X run would sweep the tweet, and a reviewer answer or X handle lookup after an hour. A stopped job gets no second try: drafts it saved stay, and the post or tweet is closed by the runner.
- A changed unit file in the devbox repository takes effect after `git pull && ./install.sh` there.
