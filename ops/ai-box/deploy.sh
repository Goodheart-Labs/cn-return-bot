#!/bin/bash
# Brings /srv/cn-notes up to origin/main and restarts the runner, but only
# while no Claude of the runner is at work. Otherwise it tries again at the
# next timer tick, 5 minutes later. Runs as root from cn-notes-deploy.timer.
set -euo pipefail
checkout=/srv/cn-notes
as_nathan() { runuser -u nathan -- "$@"; }

as_nathan git -C "$checkout" fetch -q origin main
[ "$(as_nathan git -C "$checkout" rev-parse HEAD)" = "$(as_nathan git -C "$checkout" rev-parse origin/main)" ] && exit 0

if as_nathan tmux ls -F '#S' 2>/dev/null | grep -qE '^cn-(post|msg)-'; then
  echo "A new main is waiting, but a Claude is at work. Trying again later."
  exit 0
fi

before_lock="$(as_nathan git -C "$checkout" rev-parse HEAD:bun.lock)"
as_nathan git -C "$checkout" merge -q --ff-only origin/main
if [ "$before_lock" != "$(as_nathan git -C "$checkout" rev-parse HEAD:bun.lock)" ]; then
  as_nathan bash -lc "cd $checkout && ~/.bun/bin/bun install --frozen-lockfile"
fi
systemctl restart cn-notes-runner
echo "Deployed $(as_nathan git -C "$checkout" rev-parse --short HEAD)"
