#!/usr/bin/env bash
# One-time setup of the machine that runs the claim-check, extraction and
# intake services. Run as root on a fresh Ubuntu server:
#
#   bash setup-vm.sh
#
# Afterwards two things are still manual, by design: writing the environment
# file (see ops/README.md for every variable) and starting the services. The
# script is idempotent, so re-running it after a partial failure is fine.

set -euo pipefail

REPO_URL="https://github.com/Goodheart-Labs/cn-return-bot.git"
REPO_DIR="/opt/cn-return-bot"
SERVICE_USER="cnbot"
ENV_FILE="/etc/cn-return-bot/service.env"

echo "── system packages"
apt-get update
apt-get install -y --no-install-recommends ffmpeg git pipx unzip curl jq

echo "── service user"
id "$SERVICE_USER" &>/dev/null || useradd --system --create-home --shell /bin/bash "$SERVICE_USER"

echo "── bun"
if ! sudo -u "$SERVICE_USER" test -x "/home/$SERVICE_USER/.bun/bin/bun"; then
  sudo -u "$SERVICE_USER" bash -c "curl -fsSL https://bun.sh/install | bash"
fi

echo "── yt-dlp"
sudo -u "$SERVICE_USER" bash -c "PIPX_HOME=~/.local/pipx PIPX_BIN_DIR=~/.local/bin pipx install --force yt-dlp"

echo "── repository"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_DIR"
sudo -u "$SERVICE_USER" bash -c "cd $REPO_DIR && ~/.bun/bin/bun install --frozen-lockfile"

echo "── playwright chromium (the claim checker's web-fetch ladder ends in a headless browser)"
sudo -u "$SERVICE_USER" bash -c "cd $REPO_DIR && ~/.bun/bin/bunx playwright install chromium"
bash -c "cd $REPO_DIR && npx --yes playwright install-deps chromium"

echo "── environment file"
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  # The services refuse to start on missing variables, so an empty file is a
  # safe placeholder rather than a silently misconfigured one.
  touch "$ENV_FILE"
  echo "Wrote an empty $ENV_FILE. Fill it in per ops/README.md before starting the services."
fi
chmod 0600 "$ENV_FILE"

echo "── swap (a Chromium spike on a small machine becomes slow instead of fatal)"
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "── systemd units"
for unit in cn-claim-check cn-extraction cn-intake cn-autodeploy; do
  cp "$REPO_DIR/ops/$unit.service" "/etc/systemd/system/$unit.service"
done
cp "$REPO_DIR/ops/cn-autodeploy.timer" /etc/systemd/system/cn-autodeploy.timer
systemctl daemon-reload
systemctl enable cn-claim-check cn-extraction cn-intake
systemctl enable --now cn-autodeploy.timer
rm -f /etc/sudoers.d/cn-restart

echo "── firewall (only if ufw is active)"
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 8787/tcp comment "cn claim-check service"
  ufw allow 8788/tcp comment "cn extraction service"
fi

echo
echo "Done. Next steps, in order:"
echo "  1. Fill in $ENV_FILE (see ops/README.md)."
echo "  2. systemctl start cn-claim-check cn-extraction cn-intake"
echo "  3. curl each health endpoint from outside, with the secret header."
