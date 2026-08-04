# Store submissions (AMO + Chrome Web Store)

Everything learned shipping 0.1.x to both stores (Aug 2026). Read this before
any store upload.

## The golden rule: run the reviewer simulation first

AMO reviewers rebuild the submitted source package and diff it against the
uploaded extension — **"there must be no differences"**. Before every upload,
run their exact procedure:

```bash
# 1. Build the artifacts from a clean main
bun run zip-ext
git archive --format=zip -o src/everything-extension/.output/common-notes-firefox-sources.zip \
  --add-file=BUILD_INSTRUCTIONS.md HEAD -- \
  package.json bun.lock src/everything-extension src/everything-shared \
  src/everything-web src/dashboard-shared src/pipeline/media

# 2. Simulate the reviewer: unzip sources somewhere ELSE, build, diff
mkdir /tmp/reviewer-sim && cd /tmp/reviewer-sim
unzip <sources zip> && bun install
printf "VITE_SUPABASE_URL=…\nVITE_SUPABASE_ANON_KEY=…\n" > .env.prod-backend  # PROD values!
cd src/everything-extension && bunx wxt zip -b firefox --mode prod-backend
diff -r .output/firefox-mv2-prod-backend <repo>/src/everything-extension/.output/firefox-mv2-prod-backend
```

The diff must be empty. This caught, at various points: a missing source file,
the wrong env baked in, and three separate path-reproducibility bugs.

## Why the build is shaped the way it is (wxt.config.ts)

- **`build.minify: false`** — minified output is not path-reproducible (the
  minifier's identifier assignment follows module ids, which embed absolute
  paths), and Mozilla recommends unminified extensions anyway (code loads from
  disk; there is no network win). Also makes AMO's linter able to read us.
- **`cn-force-prod-react` plugin** — WXT defines `process.env.NODE_ENV` as the
  MODE NAME in every bundle, so `--mode prod-backend` shipped React's
  development build (~2× size). Its lib-mode per-entrypoint config overrides a
  user-level `define`, so the fix is a plugin `config` hook (runs after WXT's
  merge, in child builds too). It also flips the process-level NODE_ENV, which
  drives plugin-react's JSX-transform choice — the dev transform bakes
  absolute-path `_jsxFileName` vars into every component.
- **`cn-path-independent-output` plugin** — rolldown's unminified output labels
  modules with `//#region` comments carrying WXT's virtual-module ids, which
  embed the repo's absolute path; the plugin strips the machine-specific prefix.
- **`zip.excludeSources`** — WXT's auto sources zip once contained
  `chrome-signing-key.pem` (the private key pinning our Chrome extension id).
  That zip is ALSO incomplete for AMO (it can't see imports outside the
  extension folder) — never upload it; build reviewer sources with
  `git archive` (tracked files only, structurally leak-proof).

## The sources package

- `git archive` over: `package.json bun.lock src/everything-extension
  src/everything-shared src/everything-web src/dashboard-shared
  src/pipeline/media` (that last one: `dashboard-shared/media.ts` imports
  `pipeline/media/bestMediaUrl`). If the sim fails with "Could not resolve",
  a path is missing from this list.
- Include a `BUILD_INSTRUCTIONS.md` (via `--add-file`) stating: we build with
  **Bun** (a deviation from AMO's default Node/npm reviewer environment — must
  be declared), the exact Bun version, every command, and the **prod** env
  values (`.env.prod-backend`, NOT the root `.env`, which is the LOCAL
  Supabase). The anon key is public by design and fine to include.

## AMO account/listing landmines

- **Never delete an AMO listing.** The gecko id is permanently burned
  ("Duplicate add-on ID found" on any resubmission). This killed
  `common-notes@commonnotes.net`; the id is now `extension@commonnotes.net`.
  Changing the id changes the Firefox OAuth redirect URL (SHA-1 of the id) —
  the Supabase allow-list must be updated in the prod dashboard.
- **Version numbers are burned too**: any version that ever reached AMO —
  even on a deleted listing or failed attempt — can't be reused. Bump patch
  and move on.
- The **source upload field only appears** after answering **Yes** to "Do you
  use minified, concatenated or otherwise machine-generated code?" (bundled
  TypeScript = yes, even unminified). Missed it? Attach afterwards: My Add-ons
  → Manage Status & Versions → the version → Source code → Browse.
- `data_collection_permissions` in the manifest is mandatory for new
  submissions (since Nov 2025). Ours: required `browsingActivity` (reading
  notes sends covered-page URLs), optional `authenticationInfo` +
  `personallyIdentifyingInfo` (sign-in is optional).
- Validation **warnings don't block** (only errors do). `innerHTML` warnings
  are React's internals; "Unexpected Callee" spam was the linter choking on
  minified syntax (gone now that builds are unminified).
- Listing icon: full-bleed 128×128 (`assets/store-icon-128-full.png`) — NOT
  the manifest's padded one.

## Chrome Web Store differences

- Identity comes from the manifest `key` field / `key.pem`, not the gecko id.
  First upload: strip `key` from manifest.json, put the private key in the zip
  root as `key.pem`. Every later upload: plain zip, `key` stripped, NO pem.
- Store icon rule is the opposite of AMO's: 96×96 artwork inside a 16px
  transparent margin (the manifest's `public/icon/128.png`).
- No source-code submission, no data-collection manifest key; instead the
  dashboard's privacy tab wants per-permission justifications and a privacy
  policy URL (https://commonnotes.net/privacy/ — one combined product policy
  is fine as long as the extension's flows are fully disclosed).

## Privacy policy coupling

The policy states the site uses no analytics. If PostHog (PR #328) or anything
similar ever merges, update https://commonnotes.net/privacy/ in the same
change: name the party and what it captures.
