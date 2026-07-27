# Updating the "Is this true?" Chrome Web Store listing to Common Notes

For whoever holds the Chrome Web Store developer account (Nathan/Rob). Goal: the existing
"Is this true?" store listing becomes the Common Notes extension. Every step:

## 1. Get the new build

1. Download `common-notes-<version>-chrome.zip` from the
   [`extension-latest` release](https://github.com/Goodheart-Labs/cn-return-bot/releases/tag/extension-latest)
   (rebuilt automatically from `main`).

## 2. Prepare the zip for the existing listing

2. Unzip it and open `manifest.json`.
3. **Delete the `"key"` line** — the listing already has its own extension ID; an uploaded
   package with a foreign key is rejected.
4. **Raise `"version"` above the listing's current version** (dashboard shows it; the old
   repo was at 1.1.0, so e.g. `"version": "1.2.0"`). Uploads with a lower version are rejected.
5. Re-zip the folder's *contents* (manifest.json at the zip root, not inside a subfolder).

## 3. Upload

6. Sign in at the [developer dashboard](https://chrome.google.com/webstore/devconsole).
7. Open the "Is this true?" item → **Package** → **Upload new package** → the zip from step 5.

## 4. Rebrand the listing

8. **Store listing** tab: name → `Common Notes`; description → "Community notes inline on
   the pages you read — Substack, YouTube, ai-2040, and more on request."; icon → the
   128px icon (in the zip under `icon/128.png`); refresh screenshots when convenient.
9. **Privacy** tab: justify the permissions if prompted (storage: settings/session;
   identity: sign-in; contextMenus: write/request notes; activeTab+scripting: on-demand
   note-request card; tabs: popup reads the current page; host substack.com: show notes there).

## 5. Submit and expect

10. **Submit for review.** New permissions vs the old extension mean manual review —
    allow days, possibly 1–3 weeks.
11. After it publishes, **existing users are disabled** until they re-accept the new
    permissions (a "needs new permissions" prompt) — expected, the permission set changed.

## 6. After publish — one backend step

12. Send Jim the listing's **extension ID** (visible in the dashboard URL / item page).
    The Supabase redirect allow-list needs `https://<that-id>.chromiumapp.org/**` added
    (Auth → URL Configuration) or **sign-in with X breaks** for store installs.
    (Email-code sign-in is unaffected.)

## If there is no store listing after all

The old repo only ever shipped GitHub-release zips, so if nothing exists in the dashboard:
create a **new item** instead and upload the zip **unchanged** (keep the `"key"` — it claims
our pinned extension ID `jodkhmefbcmgldokmeicpdogkepmcnij`, whose sign-in redirect is
already allow-listed; skip steps 3–4 and 12).
