#!/usr/bin/env bash
# Starts a dashboard server and, on the VPS, confirms from Jim's Mac that
# http://localhost:<port>/ shows it.
#
#   scripts/serve-for-mac.sh <port> <command...>
#
# The command must listen on 127.0.0.1:<port>. Whatever else listens on that
# port is stopped first, so `bun run review` from one checkout replaces the
# review dashboard another checkout started. Only listeners are stopped: the
# tunnel's own connections also touch the port and must survive.
# On a machine without mac-tunnel, for example Nathan's laptop, the command
# just runs and the URL is printed without a check.
set -euo pipefail

port="$1"; shift
SERVER_START_TIMEOUT_SECONDS=60
PORT_RELEASE_TIMEOUT_SECONDS=5

listener_pids() { lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true; }

old="$(listener_pids)"
if [ -n "$old" ]; then
  echo "stopping the server that already listens on port $port (pid $old, $(readlink "/proc/$(echo "$old" | head -1)/cwd"))"
  kill $old
  waited=0
  while [ -n "$(listener_pids)" ] && [ "$waited" -lt "$PORT_RELEASE_TIMEOUT_SECONDS" ]; do sleep 1; waited=$((waited + 1)); done
fi

"$@" &
server=$!
trap 'kill $server 2>/dev/null' EXIT

waited=0
until [ -n "$(listener_pids)" ]; do
  kill -0 "$server" 2>/dev/null || { echo "the server exited before it listened on port $port" >&2; exit 1; }
  [ "$waited" -lt "$SERVER_START_TIMEOUT_SECONDS" ] || { echo "the server did not listen on port $port within ${SERVER_START_TIMEOUT_SECONDS}s" >&2; exit 1; }
  sleep 1; waited=$((waited + 1))
done

if command -v mac-tunnel >/dev/null; then
  # The server keeps running when the check fails, for example while the Mac
  # is asleep. The failure is printed here and the check can be run again.
  mac-tunnel check "$port" || echo "MAC CHECK FAILED, see above. The server keeps running; run 'mac-tunnel check $port' again once the cause is fixed." >&2
else
  echo "mac-tunnel is not installed on this machine, so no Mac check. Open http://localhost:$port/"
fi

wait "$server"
