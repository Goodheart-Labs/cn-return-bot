#!/bin/bash

# Download selected community note videos using yt-dlp
# 5 AI-generated videos and 5 non-AI videos from video_notes.csv

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_DIR="$SCRIPT_DIR/ai_generated"
NON_AI_DIR="$SCRIPT_DIR/non_ai"

mkdir -p "$AI_DIR" "$NON_AI_DIR"

# --- AI-generated videos ---

# Lion's kindness - AI via Google Veo 3
yt-dlp -o "$AI_DIR/lion_kindness_2016918254501921020.%(ext)s" \
  "https://x.com/i/web/status/2016918254501921020"

# Cruise ship sewage - AI-generated fictional ship
yt-dlp -o "$AI_DIR/cruise_ship_sewage_2016119830760587528.%(ext)s" \
  "https://x.com/i/web/status/2016119830760587528"

# LOTR behind the scenes - AI-generated images
yt-dlp -o "$AI_DIR/lotr_bts_2019449543461421120.%(ext)s" \
  "https://x.com/i/web/status/2019449543461421120"

# Man cave timelapse - AI-generated
yt-dlp -o "$AI_DIR/man_cave_2024258437379408106.%(ext)s" \
  "https://x.com/i/web/status/2024258437379408106"

# Gorilla funny videos - AI-generated compilation
yt-dlp -o "$AI_DIR/gorilla_2015838544594645030.%(ext)s" \
  "https://x.com/i/web/status/2015838544594645030"

# "Thank you for your kindness" - AI-generated
yt-dlp -o "$AI_DIR/kindness_2018963907826872376.%(ext)s" \
  "https://x.com/i/web/status/2018963907826872376"

# Sheep shearing machine - AI-generated
yt-dlp -o "$AI_DIR/sheep_shearing_2023621308718690651.%(ext)s" \
  "https://x.com/i/web/status/2023621308718690651"

# --- Non-AI videos (no AI-generation mentioned in notes) ---

# CheaterBuster disguised advertisement
yt-dlp -o "$NON_AI_DIR/cheaterbuster_ad_2018097034650153439.%(ext)s" \
  "https://x.com/i/web/status/2018097034650153439"

# False impeachment claim
yt-dlp -o "$NON_AI_DIR/impeachment_claim_2014876147952029785.%(ext)s" \
  "https://x.com/i/web/status/2014876147952029785"

# Guardiola snub - edited with flags/text, not AI-generated
yt-dlp -o "$NON_AI_DIR/guardiola_snub_2024704608535200019.%(ext)s" \
  "https://x.com/i/web/status/2024704608535200019"

# BOPE training drill presented as real incident
yt-dlp -o "$NON_AI_DIR/bope_drill_2024988501440074066.%(ext)s" \
  "https://x.com/i/web/status/2024988501440074066"

# Staged airliner skit
yt-dlp -o "$NON_AI_DIR/staged_airliner_2015221897710231670.%(ext)s" \
  "https://x.com/i/web/status/2015221897710231670"

# GTA 6 gameplay - fake, not AI
yt-dlp -o "$NON_AI_DIR/gta6_fake_2020899555064287421.%(ext)s" \
  "https://x.com/i/web/status/2020899555064287421"

# Spirited Away - misused post
yt-dlp -o "$NON_AI_DIR/spirited_away_2011836546345767115.%(ext)s" \
  "https://x.com/i/web/status/2011836546345767115"

# Italian trousers - actually Gurkha pants
yt-dlp -o "$NON_AI_DIR/gurkha_pants_2012457935977202130.%(ext)s" \
  "https://x.com/i/web/status/2012457935977202130"

# Japanese wrapping - actually Chinese
yt-dlp -o "$NON_AI_DIR/wrapping_2024739483137028504.%(ext)s" \
  "https://x.com/i/web/status/2024739483137028504"

# Rust removal - fake product demo
yt-dlp -o "$NON_AI_DIR/rust_removal_2018288918249058638.%(ext)s" \
  "https://x.com/i/web/status/2018288918249058638"

echo "Done downloading videos."
