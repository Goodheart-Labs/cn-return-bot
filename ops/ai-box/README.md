# The Claude note writer on ai-box (GOO-580, GOO-787)

Nathan's ai-box (2.31.1.171) runs Jim's Claude note writer, the notewriter
`claude-ai-box`. Since GOO-787 (2026-11-19) it runs on Jim's notewriter
account, a Claude Code subscription used for nothing else. Until 2026-11-01 it
ran on Nathan's own plan.

A runner (`src/claude-notes/runner.ts`) starts one headless Claude
(`claude -p`) per job, each in its own tmux session so a person can attach
and watch:

| Job | tmux session | At once |
|---|---|---|
| A Common Notes post from the post list | `cn-post-<item>` | 5 |
| An X tweet the X run handed to Claude (GOO-527) | `cn-x-<run id>` | 6 |
| A reviewer's message on the review page | `cn-msg-<draft>` | any |
| A creator whose X account nobody looked up | `cn-xacct-<slug>` | 1 |
| A posted note to judge (a child process, no tmux) | none | 1 |

A post whose Claude exits twice without a report fails its reservation, and
the post stays listed for the other notewriters. Nothing goes to the
pipeline. Before a post's or a tweet's Claude starts, every image it links to
goes through the image screen (`src/claude-notes/imageScreen.ts`, GOO-815).

## What is where

| Path | What it is |
|---|---|
| `/srv/cn-notes` | A checkout of main, owned by `nathan`, group `team`. Only the deploy timer changes it, and it follows whatever branch is checked out. |
| `/home/nathan/.claude-cn-notewriter` | The config folder of Jim's notewriter account: its login in `.credentials.json` and Claude Code's own files. The unit file points Claude Code here with `CLAUDE_CONFIG_DIR`, so Nathan's own login in `~/.claude` is never used. |
| `/etc/cn-notes/env` | The secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `EXTRACTION_URL`, `SERVICE_AUTH_SECRET`, `SLACK_BOT_TOKEN` (the alerts) and `OPENAI_API_KEY` (the image screen). Owned by root, readable by `nathan` only. The runner removes all but the database keys from its Claudes' environment. |
| `/var/tmp/cn-notes/<item id>/` | One run folder per post: the prompt, the Claude's output stream, its drafts and `report.json`. The runner deletes folders older than 3 days. |
| `/var/tmp/cn-notes/x-<run id>/` | One run folder per X tweet: the prompt, the output stream and `note.json`. |
| `~nathan/.local/share/claude-note-finder/posts/` | The post texts that `take` writes. |
| `~nathan/.local/share/cn-notes/note-examples.md` | The examples file, rebuilt once a day by the runner. |
| `/srv/ai-box/PAUSE` | Nathan's pause switch. While it exists, the runner starts nothing. |
| `/srv/ai-box/run-settings.json` | Nathan's guard hook, which every Claude of the runner runs under. |

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
ssh jim@2.31.1.171
sudo -u nathan -i
mkdir -m 700 ~/.claude-cn-notewriter            # only the first time
CLAUDE_CONFIG_DIR=~/.claude-cn-notewriter ~/.local/bin/claude auth login
# Choose the Claude subscription, open the link, sign in, paste the code back.
CLAUDE_CONFIG_DIR=~/.claude-cn-notewriter ~/.local/bin/claude auth status
```

`auth status` should name the notewriter account and its plan. If
`claude auth login` is unknown, run `~/.local/bin/claude update` first.

## Alerts

The runner tells the Claude notes channel in Slack when its login no longer
works, when it could not read the usage for 30 minutes, when 3 Claude jobs in
a row failed, and when the image screen stopped a job (`src/claude-notes/alerts.ts`).
Each problem is posted once when it starts and once when it clears. A runner
that stopped altogether is noticed by cn-walk's silence watch after 30
minutes.

## First-time setup (as root)

```bash
git clone https://github.com/Goodheart-Labs/cn-return-bot.git /srv/cn-notes
chown -R nathan:team /srv/cn-notes
runuser -u nathan -- bash -lc 'cd /srv/cn-notes && ~/.bun/bin/bun install --frozen-lockfile'
install -d -m 750 -o root -g nathan /etc/cn-notes
install -m 640 -o root -g nathan /dev/null /etc/cn-notes/env   # then fill in the six variables
cp /srv/cn-notes/ops/ai-box/cn-notes-*.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cn-notes-runner cn-notes-deploy.timer
```

Then log in to the notewriter account as above.

## Day to day

- `journalctl -u cn-notes-runner -f` shows what the runner starts and ends.
- `sudo -u nathan tmux attach -t cn-post-<first 8 characters of the item id>` shows a Claude at work.
- A merged PR reaches the box within 5 minutes, as soon as no Claude of the runner is at work, and after an hour of waiting even while one is (`journalctl -u cn-notes-deploy`). The restart stops only the runner; the new runner adopts the Claudes still at work.
- A changed unit file must be copied to `/etc/systemd/system/` by hand, followed by `systemctl daemon-reload`.
