#!/usr/bin/env bash
# Pulls the repository and restarts the services, but only when there is
# something new and the machine is idle. Once a day it also upgrades yt-dlp.
# A systemd timer runs this every few minutes as root; there is no push deploy
# from GitHub.
#
# The whole script lives inside main() so that bash has read all of it before
# any of it runs. Without that, the reset --hard below would replace this very
# file mid-execution and bash would continue reading the new version at the old
# byte offset. For the same reason the exit sits on the line that calls
# main(), so that bash never reads past that line once the file has changed.

set -euo pipefail

REPO_DIR="/opt/cn-return-bot"
ENV_FILE="/etc/cn-return-bot/service.env"
SERVICE_USER="cnbot"
# A deploy runs the copy of this script that was checked out before it, since
# bash reads all of main() before the reset below. So a unit added to this list
# is first installed by the deploy after the one that adds it. A new unit must
# be installed by hand once (cp, daemon-reload, enable --now), as cn-fetch was
# on 2026-09-28.
UNITS=(cn-claim-check cn-extraction cn-intake cn-fetch)

# When yt-dlp was last upgraded. The file's modification time is the record.
YT_DLP_UPGRADE_STAMP="/var/lib/cn-autodeploy/yt-dlp-upgraded"
YT_DLP_UPGRADE_EVERY_MINUTES=1440

# Whether no service has work in flight or waiting. A restart or an upgrade
# kills the in-flight calls, and the callers do retry, but there is no reason
# to make them when waiting a few minutes for the queue to drain avoids it. A
# service that does not answer its health endpoint counts as idle, because the
# update may be the fix for whatever is wrong with it.
machine_is_idle() {
  local secret port health
  secret=$(grep -m1 '^SERVICE_AUTH_SECRET=' "$ENV_FILE" | cut -d= -f2-)
  for port in "${CLAIM_CHECK_PORT:-8787}" "${EXTRACTION_PORT:-8788}"; do
    if health=$(curl -fsS -m 5 -H "x-cn-service-key: $secret" "http://localhost:$port/health"); then
      if ! echo "$health" | jq -e '.inFlight + .waiting == 0' > /dev/null; then
        echo "busy on port $port"
        return 1
      fi
    fi
  done
}

main() {
  deploy_new_code
  upgrade_yt_dlp_once_a_day
}

deploy_new_code() {
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
    return 0
  fi
  if ! machine_is_idle; then
    echo "deferring deploy of ${upstream:0:10}"
    return 0
  fi

  echo "deploying $branch ${upstream:0:10} (was ${here:0:10})"
  sudo -u "$SERVICE_USER" git -C "$REPO_DIR" reset --hard "origin/$branch"
  sudo -u "$SERVICE_USER" bash -c "cd $REPO_DIR && ~/.bun/bin/bun install --frozen-lockfile"

  # The units and this script's own timer may have changed with the code. A
  # deploy runs the previous copy of this script, so its list can name a unit
  # whose file the new code removed. Such a unit is skipped, so that removing a
  # service never stops a deploy halfway.
  local unit
  for unit in "${UNITS[@]}" cn-autodeploy; do
    if [ -f "$REPO_DIR/ops/$unit.service" ]; then
      cp "$REPO_DIR/ops/$unit.service" "/etc/systemd/system/$unit.service"
    fi
  done
  cp "$REPO_DIR/ops/cn-autodeploy.timer" /etc/systemd/system/cn-autodeploy.timer
  systemctl daemon-reload
  # try-restart, not restart: it restarts only units that are already running.
  # A unit someone stopped on purpose (intake stays off until the cutover PR
  # merges) must not be switched back on by a deploy.
  systemctl try-restart "${UNITS[@]}"
  echo "deployed ${upstream:0:10}"
}

# yt-dlp must follow YouTube's player, which changes every few weeks, and
# yt-dlp ships a fix each time. GitHub Actions installs the newest yt-dlp on
# every run, so this keeps the services machine about as current. Until
# GOO-603 the machine kept the version it was set up with. A failed upgrade
# fails this unit, after the deploy above has already happened, and it is
# tried again on the next tick.
upgrade_yt_dlp_once_a_day() {
  if [ -n "$(find "$YT_DLP_UPGRADE_STAMP" -mmin "-$YT_DLP_UPGRADE_EVERY_MINUTES" 2> /dev/null)" ]; then
    return 0
  fi
  if ! machine_is_idle; then
    echo "deferring the yt-dlp upgrade"
    return 0
  fi
  sudo -u "$SERVICE_USER" bash -c 'PIPX_HOME=~/.local/pipx PIPX_BIN_DIR=~/.local/bin pipx upgrade yt-dlp'
  mkdir -p "$(dirname "$YT_DLP_UPGRADE_STAMP")"
  touch "$YT_DLP_UPGRADE_STAMP"
  echo "yt-dlp is at $(sudo -u "$SERVICE_USER" /home/$SERVICE_USER/.local/bin/yt-dlp --version)"
}

main "$@"; exit
