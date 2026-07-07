#!/bin/zsh
# Unattended daily notewriter scrape, driven by launchd.
# See scripts/com.cnreturnbot.dailyscrape.plist for the schedule.
#
# Runs the incremental scrape: from the top of the notewriter page, catching up
# to ~1 week before the oldest known-unscraped note. If there is no unsynced
# backlog, it re-samples recent notes for fresh view-count datapoints.
set -u

REPO_DIR="/Users/jimmaar/Github/cn-return-bot"
LOG_DIR="$HOME/Library/Logs/cn-scrape"
export PATH="$HOME/.bun/bin:$PATH"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d_%H%M%S).log"

cd "$REPO_DIR" || exit 1

echo "=== daily scrape started $(date) ===" | tee "$LOG_FILE"
bun run scrape --incremental 2>&1 | tee -a "$LOG_FILE"
echo "=== daily scrape finished $(date) (exit ${pipestatus[1]:-?}) ===" | tee -a "$LOG_FILE"
