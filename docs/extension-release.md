# Releasing the extension to the stores

The extension is listed in two stores: the Chrome Web Store (Chrome and Edge)
and Firefox Add-ons, Mozilla's store, usually called AMO
(addons.mozilla.org). The listing addresses and IDs are in
[prod-config.md](prod-config.md), section "Browser extension stores".

Both stores have an API, a web interface that programs call instead of a
person clicking through the dashboard. They cover different things:

| Task | Firefox (AMO) | Chrome Web Store |
|---|---|---|
| Upload a new package | API | API |
| Submit it for review | API | API |
| Source archive and notes for the reviewer | API | not needed |
| Homepage link, icon, screenshots | API | dashboard by hand |

`src/everything-extension/scripts/release.ts` does every step that has an
API. The Chrome listing's icon, screenshots and homepage link have no API, so
they are changed in the Chrome Web Store dashboard.

## Credentials

Both APIs need credentials that live in the env file
`~/dev/env/cn-return-bot/env`, which every worktree links to as `.env`.

**AMO.** Log in to addons.mozilla.org with the account that owns the add-on.
Open <https://addons.mozilla.org/en-US/developers/addon/api/key/> and press
"Generate new credentials". Put the two values into the env file:

```
AMO_JWT_ISSUER=user:12345:678
AMO_JWT_SECRET=...
```

The script signs a short-lived token with them for every request. A JWT (JSON
Web Token) is a small signed note that says who is calling and expires after
a minute.

**Chrome Web Store.** The API accepts a Google Cloud *service account*, an
account that belongs to a program instead of a person.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project (for example `common-notes-release`) and enable the "Chrome Web
   Store API" in it.
2. Under IAM and admin, then Service accounts, create a service account. It
   needs no roles. Open it, go to Keys, add a key of type JSON, and save the
   downloaded file as `~/dev/env/cn-return-bot/cws-service-account.json`.
3. In the [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole),
   open Account and add the service account's email address for API access.
   A publisher can have only one service account.
4. The publisher ID is the long ID in the dashboard's address, right after
   `devconsole/`. Put both values into the env file:

```
CWS_PUBLISHER_ID=...
CWS_SERVICE_ACCOUNT_KEY_FILE=/home/jim/dev/env/cn-return-bot/cws-service-account.json
```

## Steps

1. **Bump the version** in `src/everything-extension/wxt.config.ts`. Both
   stores refuse a version they already have. Commit the bump.
2. **Build the packages.** `bun run release-ext package` refuses to run with
   uncommitted changes, because the source archive Mozilla's reviewers rebuild
   from is made from the committed tree with `git archive`. It writes three
   files into `src/everything-extension/.output/release-<version>/`:
   `chrome-store.zip`, which is the Chrome build without the manifest's `key`
   field (the store refuses packages that carry one); `firefox.zip`; and
   `source.zip`.
3. **Screenshots**, if the UI changed. See the section below.
4. **Firefox listing.** `bun run release-ext firefox-listing` sets the
   homepage to commonnotes.net, uploads the icon
   (`src/everything-extension/assets/store-icon-128-full.png`), and replaces
   the screenshots with the files in `src/everything-extension/store-assets/screenshots/`,
   in file name order. These changes are live at once.
5. **Firefox version.** `bun run release-ext firefox-submit` uploads
   `firefox.zip`, waits for Mozilla's automatic validation, and then submits
   the version with `source.zip` and the reviewer notes from
   `src/everything-extension/store-assets/amo-reviewer-notes.txt`. The version
   goes public once a reviewer approves it. Update the notes when the build
   steps change.
6. **Chrome package.** `bun run release-ext chrome-upload` uploads
   `chrome-store.zip` as a draft. Nothing is visible to users yet.
   `bun run release-ext chrome-status` shows the draft's state.
7. **Chrome listing, by hand.** In the dashboard, open the item, then "Store
   listing". The store icon is `src/everything-extension/public/icon/128.png`,
   which keeps the 16 pixel transparent margin Google asks for. Replace the
   screenshots with the same files as for Firefox. The homepage link is under
   "Additional fields", "Homepage URL". Save the draft.
8. **Chrome submit.** `bun run release-ext chrome-publish` submits the draft,
   package and listing together, for review. It goes live by itself once
   approved.

**Never delete the AMO listing**, not even to start over. The reason is in
prod-config.md.

## Without API credentials

`package` needs no credentials. Every other step can also be done in the
store dashboards, using the files `package` wrote. A Claude session can do
that in a Chrome on the Mac: start Chrome there with a remote debugging port,
which lets a program control it, and with its own profile, because Chrome
refuses remote debugging on the everyday profile.

```bash
ssh jimmaar@jims-macbook-air 'open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile'
ssh -N -L 9223:localhost:9222 jimmaar@jims-macbook-air   # then Playwright's connectOverCDP("http://localhost:9223")
```

Copy the upload files to the same absolute path on the Mac, so file uploads
find them whether Playwright sends the path or the contents. Two traps:

- On AMO, pressing "Continue" after the package upload already creates the
  version and puts it into the review queue. The source archive and reviewer
  notes come on the pages after it, so finish those in one go.
- On AMO, each section of "Edit Product Page" goes live as soon as it is
  saved. In the Chrome dashboard, "Save draft" changes nothing public; only
  "Submit for review" does.

## Screenshots

Both stores get the same screenshots: 1280 by 800 pixels, light mode. The
Chrome Web Store accepts only exactly 1280x800 or 640x400, and AMO shows
images in that 16:10 shape best. Take each screenshot on a Retina screen, so
it is about twice that size, and fit it with:

```bash
uv run src/everything-extension/scripts/fit_store_screenshot.py <in.png> <out.png> --crop X,Y,WIDTH,HEIGHT
```

The tool never squishes. It cuts out the crop box, pads the short side with
the colour of the box's top-left pixel until the shape is 16:10, and only then
scales evenly. So choose a crop box that cuts away empty page or a black video
bar, and let the padding handle the rest.

The order as of version 0.4.0:

1. A note card next to a Substack post.
2. A note on a Dwarkesh Podcast video on YouTube.
3. The "Write a note" form on a highlighted sentence.
4. The toolbar popup on a page we have not checked yet, offering "Request notes on this page".
