#!/bin/bash
# Brings /srv/cn-notes up to its branch on GitHub (main, or a PR branch while
# one is being tried) and restarts the runner. It waits while a Claude of the
# runner is at work, and tries again at the next timer tick, 5 minutes later.
# Since GOO-787 about a dozen Claudes run at once and the runner is rarely
# idle, so after an hour of waiting it deploys anyway. The restart stops only
# the runner, and the new runner adopts the Claudes that are still at work.
# Runs as root from cn-notes-deploy.timer.
set -euo pipefail
checkout=/srv/cn-notes
waiting_since_file=/var/lib/cn-notes-deploy/waiting-since
max_wait_seconds=3600
as_nathan() { runuser -u nathan -- "$@"; }

branch="$(as_nathan git -C "$checkout" symbolic-ref --short HEAD)"
as_nathan git -C "$checkout" fetch -q origin "$branch"
if [ "$(as_nathan git -C "$checkout" rev-parse HEAD)" = "$(as_nathan git -C "$checkout" rev-parse "origin/$branch")" ]; then
  rm -f "$waiting_since_file"
  exit 0
fi

mkdir -p "$(dirname "$waiting_since_file")"
[ -f "$waiting_since_file" ] || date +%s > "$waiting_since_file"
waited=$(( $(date +%s) - $(cat "$waiting_since_file") ))
if as_nathan tmux ls -F '#S' 2>/dev/null | grep -qE '^cn-(post|msg|x|xacct)-' && [ "$waited" -lt "$max_wait_seconds" ]; then
  echo "A new $branch is waiting, but a Claude is at work. Trying again later."
  exit 0
fi
rm -f "$waiting_since_file"

before_lock="$(as_nathan git -C "$checkout" rev-parse HEAD:bun.lock)"
as_nathan git -C "$checkout" merge -q --ff-only "origin/$branch"
if [ "$before_lock" != "$(as_nathan git -C "$checkout" rev-parse HEAD:bun.lock)" ]; then
  as_nathan bash -lc "cd $checkout && ~/.bun/bin/bun install --frozen-lockfile"
fi
systemctl restart cn-notes-runner
echo "Deployed $(as_nathan git -C "$checkout" rev-parse --short HEAD)"
