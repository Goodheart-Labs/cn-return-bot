#!/usr/bin/env bash
# For each video id, fetches the watch page through the proxy as yt-dlp's web
# client does and prints the country YouTube saw and whether the page lists
# caption tracks. COUNTRY=us pins DataImpulse's exit country.
set -uo pipefail
proxy=$YTDLP_PROXY_URL
if [ -n "${COUNTRY:-}" ]; then proxy=$(echo "$proxy" | sed -E "s#//([^:]+):#//\1__cr.$COUNTRY:#"); fi
d=/tmp/goo603/p2; mkdir -p $d; cd $d
for id in "$@"; do
  rm -f $d/*.dump
  /tmp/goo603/venv/bin/yt-dlp --proxy "$proxy" --extractor-args "youtube:player_client=web" --write-pages --skip-download --ignore-no-formats-error -q --no-warnings --print "%(automatic_captions.en.0.ext|none)s" "https://www.youtube.com/watch?v=$id" > out.txt 2>err.txt
  f=$(ls $d/*.dump 2>/dev/null | head -1)
  echo "$id GL=$(grep -o '"GL":"[A-Z]*"' "$f" | head -1 | cut -d'"' -f4) page_captionTracks=$(grep -c captionTracks "$f") playability=$(grep -o 'playabilityStatus":{"status":"[A-Z_]*' "$f" | head -1 | cut -d'"' -f5) ytdlp_en=$(cat out.txt) err=$(sed "s#$YTDLP_PROXY_URL#<proxy>#g" err.txt | head -1 | cut -c1-120)"
done
