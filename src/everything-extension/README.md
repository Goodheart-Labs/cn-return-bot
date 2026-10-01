# Common Notes browser extension

Community notes inline on the pages you read — Substack, YouTube, and any other site with notes (the extension installs with access to all sites), backed by the same Supabase database as [commonnotes.net](https://commonnotes.net). The settings page, opened once after install and reachable from the popup, holds the visit-recording checkboxes, the overlay toggles, the note filters, and sign-in.

Also: **write a note on any page** — right-click selected text → "Write a Common Note on this" (the click authorizes a one-off injection; posting creates the page's entry). On uncovered pages the popup offers **"Request notes on this page"** instead, telling us where to expand coverage.

## Install without a store (self-distribution)

Download the latest build from the repo's **[extension-latest release](../../../../releases/tag/extension-latest)** (updated automatically from `main`).

### Chrome / Edge / Brave

1. Download `common-notes-<version>-chrome.zip` and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.

Because the manifest pins a public key, every install gets the same extension ID (`jodkhmefbcmgldokmeicpdogkepmcnij`), so sign-in with X works the same for everyone. Chrome shows a "developer mode extensions" reminder on startup — that's expected for non-store installs.

### Firefox

Release Firefox only runs **signed** extensions, so the raw zip can't be installed permanently:

- **Temporary (works today):** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick the `-firefox.zip`. Gone after a restart.
- **Permanent:** the zip must be signed once through Mozilla's *unlisted* (self-distribution) channel — automated, usually minutes, no store review. The signed `.xpi` can then be attached to the release and installs like any file. Not set up yet.

### Safari (Mac)

Safari only loads an extension that sits inside a Mac app, so there is no zip to load. The app is built with Xcode from `safari/`, and it carries the Safari build of the extension (`.output/safari-mv3-prod-backend/`).

1. On the machine with the repo: `bun run build-ext` (or `bun run build-ext-safari-dev` for a dev build).
2. On a Mac with Xcode, with the Safari build in place: `./safari/build-app.sh`. It prints the path of `Common Notes.app`.
3. In Safari: Settings → Advanced → turn on "Show features for web developers". Then Settings → Developer → turn on "Allow unsigned extensions". Safari switches this off again every time it quits.
4. Safari Settings → Extensions → tick Common Notes.
5. Click the Common Notes button in the toolbar and choose "Always Allow on Every Website". Safari grants no site at install, and without this step notes only appear on sites you allow one by one.

Step 3 goes away once the app is signed by an Apple developer team (`CN_APPLE_TEAM_ID=<team id> ./safari/build-app.sh`) or installed from the App Store. Sign-in on Safari is by email code only, because Safari has no API for the X sign-in window.

## Development

```bash
bun run dev-ext        # dev mode against PROD backend; load .output/chrome-mv3-prod-backend unpacked once
bun run dev-ext-local  # dev mode against the local Supabase (root .env)
bun run build-ext      # chrome + firefox + safari production builds
bun run build-ext-safari-dev  # safari dev build, the input for safari/build-app.sh
bun run zip-ext        # store-ready zips into .output/
bun test src/everything-extension   # anchor-engine tests
```

NOTE: WXT suffixes the output directory with the mode — prod-backend builds land in `.output/chrome-mv3-prod-backend/`, NOT `.output/chrome-mv3/` (that folder, if present, is a local-backend build). Load the suffixed folder.

`chrome-signing-key.pem` (gitignored) is the private half of the pinned manifest key — only needed to claim the same extension ID when publishing to the Chrome Web Store later. Back it up; don't commit it.

See the "Browser extension" section of the repo's `CLAUDE.md` for architecture, auth flows, and the Supabase dashboard prerequisites.
