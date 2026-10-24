# The Claude note writer on ai-box (GOO-580)

Nathan's ai-box (2.31.1.171) runs the Claude note writer on Nathan's Claude
subscription. A runner (`src/claude-notes/runner.ts`) watches the queue, takes
each post, starts one Claude for it in a tmux session named `cn-post-<item>`,
and finishes or hands back the item when that Claude is done. Each reviewer
message on the review page gets its own Claude in `cn-msg-<draft>`.

## What is where

| Path | What it is |
|---|---|
| `/srv/cn-notes` | A checkout of main, owned by `nathan`, group `team`. Only the deploy timer changes it, and it follows whatever branch is checked out. |
| `/etc/cn-notes/env` | The secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `EXTRACTION_URL`, `SERVICE_AUTH_SECRET`. Owned by root, readable by `nathan` only. |
| `/tmp/cn-notes/<item id>/` | One run folder per post: the prompt, the Claude's output stream, its drafts and `report.json`. |
| `~nathan/.local/share/claude-note-finder/posts/` | The post texts that `take` writes. |
| `~nathan/.local/share/cn-notes/note-examples.md` | The examples file, rebuilt once a day by the runner. |
| `/srv/ai-box/PAUSE` | Nathan's pause switch. While it exists, the runner starts nothing. |
| `/srv/ai-box/run-settings.json` | Nathan's guard hook, which every Claude of the runner runs under. |

## First-time setup (as root)

```bash
git clone https://github.com/Goodheart-Labs/cn-return-bot.git /srv/cn-notes
chown -R nathan:team /srv/cn-notes
runuser -u nathan -- bash -lc 'cd /srv/cn-notes && ~/.bun/bin/bun install --frozen-lockfile'
install -d -m 750 -o root -g nathan /etc/cn-notes
install -m 640 -o root -g nathan /dev/null /etc/cn-notes/env   # then fill in the four variables
cp /srv/cn-notes/ops/ai-box/cn-notes-*.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cn-notes-runner cn-notes-deploy.timer
```

## Day to day

- `journalctl -u cn-notes-runner -f` shows what the runner starts and ends.
- `sudo -u nathan tmux attach -t cn-post-<first 8 characters of the item id>` shows a Claude at work.
- `bun run claude-notes settings posts=2` lets the walk keep 2 feed posts queued, so Claude gets more posts at once.
- A merged PR reaches the box within 5 minutes, as soon as no Claude of the runner is at work (`journalctl -u cn-notes-deploy`).
