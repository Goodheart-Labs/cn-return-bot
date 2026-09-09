#!/usr/bin/env bash
# Pulls the repository and restarts the services, but only when there is
# something new and the machine is idle. A systemd timer runs this every few
# minutes as root; there is no push deploy from GitHub.
#
# The whole script lives inside main() so that bash has read all of it before
# any of it runs. Without that, the reset --hard below would replace this very
# file mid-execution and bash would continue reading the new version at the old
# byte offset.

set -euo pipefail

REPO_DIR="/opt/cn-return-bot"
ENV_FILE="/etc/cn-return-bot/service.env"
SERVICE_USER="cnbot"
UNITS=(cn-claim-check cn-extraction cn-intake)

main() {
  # Deploy whatever branch the checkout is on. Before the cutover PR merges
  # that is the feature branch; afterwards it is main.
  local branch
  branch=$(sudo -u "$SERVICE_USER" git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)
  sudo -u "$SERVICE_USER" git -C "$REPO_DIR" fetch --quiet origin "$branch"

  # Every git call runs as the owning user. This script runs as root, and git
  # refuses to read a repository owned by somebody else unless it is told to.
  local here upstream
  here=$(sudo -u "$SERVICE_USER" git -C "$REPO_DIR" rev-parse HEAD)
  upstream=$(sudo -u "$SERVICE_USER" git -C "$REPO_DIR" rev-parse "origin/$branch")
  if [ "$here" = "$upstream" ]; then
    exit 0
  fi

  # Only restart an idle machine. A restart kills the in-flight calls, and the
  # callers do retry, but there is no reason to make them when waiting a few
  # minutes for the queue to drain avoids it. A service that does not answer
  # its health endpoint counts as idle, because the update may be the fix for
  # whatever is wrong with it.
  local secret
  secret=$(grep -m1 '^SERVICE_AUTH_SECRET=' "$ENV_FILE" | cut -d= -f2-)
  local port health
  for port in "${CLAIM_CHECK_PORT:-8787}" "${EXTRACTION_PORT:-8788}"; do
    if health=$(curl -fsS -m 5 -H "x-cn-service-key: $secret" "http://localhost:$port/health"); then
      if ! echo "$health" | jq -e '.inFlight + .waiting == 0' > /dev/null; then
        echo "busy on port $port, deferring deploy of ${upstream:0:10}"
        exit 0
      fi
    fi
  done

  echo "deploying $branch ${upstream:0:10} (was ${here:0:10})"
  sudo -u "$SERVICE_USER" git -C "$REPO_DIR" reset --hard "origin/$branch"
  sudo -u "$SERVICE_USER" bash -c "cd $REPO_DIR && ~/.bun/bin/bun install --frozen-lockfile"

  # The units and this script's own timer may have changed with the code.
  local unit
  for unit in "${UNITS[@]}" cn-autodeploy; do
    cp "$REPO_DIR/ops/$unit.service" "/etc/systemd/system/$unit.service"
  done
  cp "$REPO_DIR/ops/cn-autodeploy.timer" /etc/systemd/system/cn-autodeploy.timer
  systemctl daemon-reload
  # try-restart, not restart: it restarts only units that are already running.
  # A unit someone stopped on purpose (intake stays off until the cutover PR
  # merges) must not be switched back on by a deploy.
  systemctl try-restart "${UNITS[@]}"
  echo "deployed ${upstream:0:10}"
}

main "$@"
