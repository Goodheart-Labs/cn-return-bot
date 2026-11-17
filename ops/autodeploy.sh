#!/usr/bin/env bash
# Pulls the repository and restarts the services, but only when there is
# something new and the machine is idle. Once a day it also upgrades yt-dlp.
# A systemd timer runs this every few minutes as root; there is no push deploy
# from GitHub.
#
# Root runs the copy in /usr/local/sbin/cn-autodeploy, not the one in the
# checkout. The checkout belongs to the service user, so a process running as
# that user could change any file in it. Root therefore never runs or installs
# a file from the checkout. It asks GitHub itself which commit is on main, and
# it downloads this script and the unit files of exactly that commit from
# GitHub. The service user only fetches and resets its own checkout.
#
# The whole script lives inside main() so that bash has read all of it before
# any of it runs, because a deploy installs a new copy of this very file. For
# the same reason the exit sits on the line that calls main(), so that bash
# never reads past that line once the file has changed.

set -euo pipefail

REPO_DIR="/opt/cn-return-bot"
REPO_URL="https://github.com/Goodheart-Labs/cn-return-bot"
RAW_URL="https://raw.githubusercontent.com/Goodheart-Labs/cn-return-bot"
DEPLOY_BRANCH="main"
INSTALLED_SCRIPT="/usr/local/sbin/cn-autodeploy"
ENV_FILE="/etc/cn-return-bot/service.env"
SERVICE_USER="cnbot"
# A deploy runs the copy of this script that was installed before it. So a
# unit added to this list is first installed by the deploy after the one that
# adds it. A new unit must be installed by hand once (cp, daemon-reload,
# enable --now), as cn-fetch was on 2026-09-28.
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
  local here upstream
  # Root's own git and its own configuration, never the service user's.
  upstream=$(HOME=/root git ls-remote "$REPO_URL" "refs/heads/$DEPLOY_BRANCH" | cut -f1)
  if [ -z "$upstream" ]; then
    echo "GitHub did not name a commit for $DEPLOY_BRANCH"
    return 1
  fi
  # Every git call on the checkout runs as the owning user. This script runs
  # as root, and git refuses to read a repository owned by somebody else
  # unless it is told to.
  here=$(sudo -u "$SERVICE_USER" git -C "$REPO_DIR" rev-parse HEAD)
  if [ "$here" = "$upstream" ]; then
    return 0
  fi
  if ! machine_is_idle; then
    echo "deferring deploy of ${upstream:0:10}"
    return 0
  fi

  # Everything root installs is downloaded before anything changes, so a
  # failed download leaves the machine as it was and the next tick retries.
  staging=$(mktemp -d)
  trap 'rm -rf "$staging"' EXIT
  download_root_files "$upstream" "$staging"

  echo "deploying $DEPLOY_BRANCH ${upstream:0:10} (was ${here:0:10})"
  sudo -u "$SERVICE_USER" git -C "$REPO_DIR" fetch --quiet origin "$DEPLOY_BRANCH"
  sudo -u "$SERVICE_USER" git -C "$REPO_DIR" reset --hard "$upstream"
  sudo -u "$SERVICE_USER" bash -c "cd $REPO_DIR && ~/.bun/bin/bun install --frozen-lockfile"

  local file
  for file in "$staging"/*.service "$staging"/*.timer; do
    install -m 644 -o root -g root "$file" "/etc/systemd/system/$(basename "$file")"
  done
  # A new file moved over the old one leaves bash reading the old one, which
  # it still has open.
  install -m 755 -o root -g root "$staging/autodeploy.sh" "$INSTALLED_SCRIPT.new"
  mv -f "$INSTALLED_SCRIPT.new" "$INSTALLED_SCRIPT"
  systemctl daemon-reload
  # try-restart, not restart: it restarts only units that are already running.
  # A unit someone stopped on purpose must not be switched back on by a deploy.
  systemctl try-restart "${UNITS[@]}"
  echo "deployed ${upstream:0:10}"
}

# Downloads this script, cn-autodeploy.service and its timer, and the units in
# UNITS, all as of the given commit. A deploy runs the previous copy of this
# script, so its list can name a unit that the new commit removed. GitHub
# answers 404 for such a unit, and it is skipped, so that removing a service
# never stops a deploy halfway. Any other failure stops the deploy.
download_root_files() {
  local commit="$1" staging="$2" path unit
  for path in ops/autodeploy.sh ops/cn-autodeploy.service ops/cn-autodeploy.timer; do
    download "$commit" "$path" "$staging" required || return 1
  done
  for unit in "${UNITS[@]}"; do
    download "$commit" "ops/$unit.service" "$staging" optional || return 1
  done
}

download() {
  local commit="$1" path="$2" staging="$3" need="$4" target status
  target="$staging/$(basename "$path")"
  status=$(curl -sS -m 30 -o "$target" -w '%{http_code}' "$RAW_URL/$commit/$path")
  if [ "$status" = 200 ]; then
    return 0
  fi
  rm -f "$target"
  if [ "$status" = 404 ] && [ "$need" = optional ]; then
    return 0
  fi
  echo "downloading $path at ${commit:0:10} answered $status"
  return 1
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
