#!/usr/bin/env bash
# Builds the Common Notes Mac app, which carries the Safari extension. Safari
# only loads an extension that sits inside a native app.
#
# Run it on a Mac with Xcode, after the Safari build of the web extension
# exists in ../.output/safari-mv3-prod-backend. That build comes from
# `bun run build-ext-safari-dev` or `bun run build-ext`.
#
# Without CN_APPLE_TEAM_ID the app is signed to run on this Mac only, and
# Safari loads it only while "Allow unsigned extensions" is switched on.
# With CN_APPLE_TEAM_ID set to an Apple developer team ID, Xcode signs the app
# with that team's development certificate.
set -euo pipefail
cd "$(dirname "$0")"

WEB_BUILD=../.output/safari-mv3-prod-backend
# The app carries the extension's own version, so the two never disagree.
VERSION=$(plutil -extract version raw "$WEB_BUILD/manifest.json")

if [ -n "${CN_APPLE_TEAM_ID:-}" ]; then
  SIGNING=(DEVELOPMENT_TEAM="$CN_APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
else
  SIGNING=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=)
fi

xcodebuild -project "Common Notes.xcodeproj" -scheme "Common Notes" -configuration Debug \
  -derivedDataPath build MARKETING_VERSION="$VERSION" "${SIGNING[@]}" -quiet build

echo "$PWD/build/Build/Products/Debug/Common Notes.app"
