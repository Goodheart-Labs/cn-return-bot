# Common Notes browser extension

Community notes inline on the pages you read — Substack, YouTube, and any other site with notes (visiting one offers a one-click enable; flip `ASSUME_ALL_URLS` in `utils/permissionsMode.ts` for the all-sites-at-install build), backed by the same Supabase database as [commonnotes.net](https://commonnotes.net).

Also: right-click any selected text on **any** page → **"Request a Common Note"** logs that you wanted a note there (no site enabling needed — the click itself authorizes a one-off injection). The inline-notes-everywhere feature isn't built yet; requests tell us where to build next.

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

## Development

```bash
bun run dev-ext        # dev mode against PROD backend; load .output/chrome-mv3-prod-backend unpacked once
bun run dev-ext-local  # dev mode against the local Supabase (root .env)
bun run build-ext      # chrome + firefox production builds
bun run zip-ext        # store-ready zips into .output/
bun test src/everything-extension   # anchor-engine tests
```

NOTE: WXT suffixes the output directory with the mode — prod-backend builds land in `.output/chrome-mv3-prod-backend/`, NOT `.output/chrome-mv3/` (that folder, if present, is a local-backend build). Load the suffixed folder.

`chrome-signing-key.pem` (gitignored) is the private half of the pinned manifest key — only needed to claim the same extension ID when publishing to the Chrome Web Store later. Back it up; don't commit it.

See the "Browser extension" section of the repo's `CLAUDE.md` for architecture, auth flows, and the Supabase dashboard prerequisites.
