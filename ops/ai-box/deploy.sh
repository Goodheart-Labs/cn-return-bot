#!/bin/bash
# Brings /srv/cn-notes up to its branch on GitHub (main, or a PR branch while
# one is being tried) and restarts the runner, without cutting off any Claude
# (GOO-787). Runs as root from cn-notes-deploy.timer every 5 minutes.
#
# The deploy freezes the runner first. When a new commit is waiting, it
# creates the drain file. The runner then starts no new Claude, and the work
# that comes in waits in the database. The Claudes already at work finish as
# usual; each has a time limit, so the freeze ends within a few hours at the
# very most. Once the runner reports that it saw the drain file and nothing is
# at work, the deploy updates the checkout, removes the drain file and
# restarts the runner, which starts the waiting work. Nothing is lost.
set -euo pipefail
checkout=/srv/cn-notes
drain_file=/var/lib/cn-notes-deploy/draining
state_file=/var/tmp/cn-notes/runner-state
# A state older than this is from a runner that stopped writing it.
max_state_age_seconds=300
as_nathan() { runuser -u nathan -- "$@"; }

branch="$(as_nathan git -C "$checkout" symbolic-ref --short HEAD)"
as_nathan git -C "$checkout" fetch -q origin "$branch"
if [ "$(as_nathan git -C "$checkout" rev-parse HEAD)" = "$(as_nathan git -C "$checkout" rev-parse "origin/$branch")" ]; then
  rm -f "$drain_file"
  exit 0
fi

# The runner reads the drain file as Nathan's user.
install -d -m 755 "$(dirname "$drain_file")"
[ -f "$drain_file" ] || { touch "$drain_file"; echo "A new $branch is waiting. Froze the runner."; }

# One value of the runner's state file, which holds lines of name=value. It is
# read, never run, because Nathan's user writes it.
state_value() { sed -n "s/^$1=\([0-9]*\)$/\1/p" "$state_file" 2>/dev/null | head -n 1; }

if systemctl is-active --quiet cn-notes-runner; then
  at="$(state_value at)"; draining="$(state_value draining)"; running="$(state_value running)"
  now="$(date +%s)"
  if [ -z "$at" ] || [ $((now - at)) -gt "$max_state_age_seconds" ] || [ "$at" -lt "$(stat -c %Y "$drain_file")" ]; then
    echo "The runner has not reported since the freeze began. Trying again later."
    exit 0
  fi
  if [ "$draining" != 1 ] || [ "$running" != 0 ]; then
    echo "Frozen, waiting for $running Claudes of the runner to finish. Trying again later."
    exit 0
  fi
fi

before_lock="$(as_nathan git -C "$checkout" rev-parse HEAD:bun.lock)"
as_nathan git -C "$checkout" merge -q --ff-only "origin/$branch"
if [ "$before_lock" != "$(as_nathan git -C "$checkout" rev-parse HEAD:bun.lock)" ]; then
  as_nathan bash -lc "cd $checkout && ~/.bun/bin/bun install --frozen-lockfile"
fi
rm -f "$drain_file"
systemctl restart cn-notes-runner
echo "Deployed $(as_nathan git -C "$checkout" rev-parse --short HEAD)"
