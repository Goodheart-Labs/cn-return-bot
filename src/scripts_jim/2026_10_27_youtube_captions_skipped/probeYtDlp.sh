#!/usr/bin/env bash
# Runs yt-dlp exactly as fetchYoutubeCaptions does, for each video id given,
# and prints the tracks it listed and its stderr with the proxy address hidden.
# Usage on the services box, as root: set -a; . /etc/cn-return-bot/service.env; set +a; sudo -u cnbot --preserve-env=YTDLP_PROXY_URL bash probeYtDlp.sh <yt-dlp binary> <id>...
set -uo pipefail
# YTDLP_PROXY_URL comes from the caller, who reads service.env as root.
bin=$1; shift
out=/tmp/goo603; mkdir -p $out
for id in "$@"; do
  pot=$(curl -s -m 30 -X POST http://127.0.0.1:4416/get_pot -H 'content-type: application/json' -d "{\"content_binding\":\"$id\"}" | jq -r .poToken)
  start=$(date +%s)
  "$bin" --proxy "$YTDLP_PROXY_URL" --extractor-args "youtube:player_client=${CLIENT:-web};po_token=${CLIENT:-web}.subs+$pot" --dump-single-json --skip-download --ignore-no-formats-error "https://www.youtube.com/watch?v=$id" > $out/$id.json 2> $out/$id.err
  code=$?
  echo "=== $id exit $code in $(( $(date +%s) - start ))s, stdout $(wc -c < $out/$id.json) bytes"
  jq -c '{subs: (.subtitles // {} | keys), auto: (.automatic_captions // {} | keys | length), auto_en: (.automatic_captions // {} | keys | map(select(startswith("en")))), availability, live_status, formats: (.formats // [] | length)}' $out/$id.json 2>&1 | head -3
  sed "s#$YTDLP_PROXY_URL#<proxy>#g" $out/$id.err | cut -c1-400 | head -15
done
