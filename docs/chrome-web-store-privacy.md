# Chrome Web Store privacy disclosures — Common Notes

This file mirrors the "Privacy" tab of the Chrome Web Store listing for the
Common Notes extension, updated to match the code as of 17 August 2026. Each
section below is one form field. The text in the code block is the proposed
answer, ready to paste (every field is under the store's 1000-character limit).
Fields that differ from what is currently live in the store carry a
"Changed because" note; fields without one can stay as they are.

The privacy policy itself is NOT duplicated here. Its source of truth is
[`src/everything-web/public/privacy/index.html`](../src/everything-web/public/privacy/index.html),
served at https://commonnotes.net/privacy — update that file, not this one.
It was rewritten together with this document (see "Privacy policy changes" at
the bottom).

## Single purpose description

```
The single purpose is to display added context, such as fact checks, on content on the internet (we call this added context Notes). Notes can be added by our AI fact-checking pipeline, or users can add them themselves. Users can rate notes, which determines whether they are shown to everyone.
```

Unchanged.

## storage justification

```
Used for: (1) The user's sign-in session (auth token of our backend, Supabase) in chrome.storage.local, because content scripts cannot share the host page's localStorage. (2) Privacy by design: every 5 minutes the background downloads the list of pages that currently have notes, plus per-page note counts, and caches them in chrome.storage.local; content scripts consult this local list first, so pages without notes never trigger any network request. A small cache of resolved Substack reader URLs serves the same purpose. (3) chrome.storage.local also holds a randomly generated device id for our self-hosted usage analytics (regenerated on sign-out) and, during the two-step email sign-in, the typed email address for up to 1 hour so the login code can be entered later (content scripts cannot read storage.session). (4) chrome.storage.sync holds small preferences: which note types to display, and which pages and authors the user already requested notes for. No browsing history is stored.
```

Changed because: the analytics device id and the reader-URL cache are new
uses; the pending sign-in email moved from `storage.session` to
`chrome.storage.local` (content scripts cannot read session storage); and the
"Do not ask again" host list no longer exists — the per-site permission prompt
was removed, and sync storage now remembers requested pages and follows
instead.

## identity justification

```
Used solely for "Sign in with X (Twitter)". The background script calls identity.getRedirectURL() and identity.launchWebAuthFlow() to run our auth provider's (Supabase) OAuth flow in a browser-controlled window; the session tokens are read from the redirect URL and stored as the login session. The flow must run in the background service worker because the popup closes during authentication. No other identity APIs or account data are accessed; email sign-in does not use this permission.
```

Unchanged (verified against `utils/oauth.ts` — still accurate).

## contextMenus justification

```
Used for two context-menu items, both shown only on text selections: "Write a Common Note on this" lets the user write a note on the selected passage, and "Request Common Notes on this" asks our fact-checking pipeline to check the selected paragraph.
```

Changed because: a second selection-only item, "Request Common Notes on this",
was added with the note-requests feature.

## activeTab justification

```
Two uses, both after an explicit user action on that one tab: (1) When "Write a Common Note on this" is clicked on a page where no content script is running, the packaged note-composer script is injected once, so users can write a note on any page they act on. (2) "Request Common Notes" (the context-menu item, or the popup's request button) reads the page's title, canonical link, and main body text via scripting.executeScript and attaches them to the request — our pipeline fact-checks the page from that captured text, because it cannot download arbitrary pages itself. The activeTab grant also keeps both features working for users who have limited the extension's site access in the browser's settings.
```

Changed because: requesting notes now captures the page's title, canonical
link, and body text under the activeTab grant, and the framing shifted — host
access is no longer "per-site opt-in", so activeTab's role is the two
click-driven features plus users who restrict site access.

## tabs justification

```
Needed to read tab URLs and titles for page-specific behaviour: (1) the popup reads the active tab's URL/title to look up and display that page's notes and to attach them to the explicit "Request notes on this page" and "Request notes from this author" actions; (2) tabs.query finds already-open tabs of a site that newly gained notes, so the notes script reaches them without a reload; (3) tabs.sendMessage passes the selected text to the note composer and drives the popup's "jump to note" button; (4) tabs.reload recovers a tab whose content script was orphaned by an extension update; (5) tabs.create opens our website from the popup. Tab URLs are checked on-device against the locally cached list of pages that have notes; only a page on that list is ever looked up on our server.
```

Changed because: the tabs.onUpdated consent-page flow it described is gone
(the per-site grant page was removed together with the optional host
permission), and the "URLs seen by this listener are never transmitted" claim
no longer holds as stated — covered pages ARE looked up on the server, and
visits to covered Substack/YouTube/LessWrong pages are counted anonymously.
The replacement text states the on-device check accurately without
overclaiming.

## scripting justification

```
Sites gain notes over time. The background syncs the list of hostnames that currently have notes and uses scripting.registerContentScripts() to register our packaged notes script for exactly those hostnames — and unregisterContentScripts() when a site drops off the list. scripting.executeScript() injects the same packaged file into already-open tabs of a newly noted site, injects the note composer after a context-menu click, and reads the page's title and text for an explicit "Request Common Notes" action. Only files and functions packaged in the extension are ever injected — never remote or dynamically generated code.
```

Changed because: registration no longer depends on a per-site user grant, and
executeScript gained the page-capture use for note requests.

## alarms justification

```
A single alarm ("cn-sync-noted-sites", every 5 minutes) re-downloads the list of pages and sites that currently have notes, plus per-page note counts. The list powers the on-device page check that prevents any network request for pages without notes, and determines which sites get the notes script registered.
```

Changed because: the sync now also caches per-page note counts (for the
listing badges), and the "granted sites" wording was dropped.

## Host permission justification

```
1) *://*.substack.com/* and *://*.youtube.com/* (static content scripts): the platforms most notes are written about, so the notes script always runs there to highlight noted passages and show the YouTube timestamp overlay. 2) https://*.supabase.co/*: our own backend (database and auth); content scripts must fetch notes and submit votes and notes from inside third-party pages. 3) <all_urls> (required at install): notes can exist on any website, and which sites have them changes daily on the server. The background keeps a synced list of noted hostnames and registers the notes script for exactly those hosts, so a newly noted site reaches users without a store update or per-site permission prompts. Privacy safeguard: content scripts check every page on-device against the locally cached noted-pages list BEFORE any network request, so pages without notes never contact our server. The permission also lets the background resolve Substack reader links via a cookie-less fetch.
```

Changed because: this is the biggest change. `<all_urls>` is now a REQUIRED
install-time permission (manifest `host_permissions`), not an optional one
requested per site — the "Show notes on this site" consent flow and the
per-site decline memory were removed in August 2026. The justification must
say that plainly, and the on-device check is the privacy story that makes it
defensible. (Note: existing installs are disabled by Chrome until the user
approves the broadened permission.)

## Remote code

```
Nein, ich verwende "remote code" nicht / No, I am not using remote code
```

Unchanged. Verified: no CDN scripts or remote fetch-and-eval anywhere;
supabase-js is bundled; every `scripting.executeScript` call injects a
packaged file or a function serialized from the packaged bundle; PostHog (a
third-party analytics bundle) has been removed entirely.

## Data usage checkboxes

Proposed selections, with what changed:

| Checkbox (German form label) | Currently | Proposed | Why |
| --- | --- | --- | --- |
| Personenidentifizierbare Informationen (PII) | ✔ | ✔ keep | Email address on email sign-in; X handle, display name, and email on X sign-in. |
| Authentifizierungsdaten | ✔ | ✔ keep | Supabase session tokens stored in extension storage. |
| Webprotokoll (web history) | ✔ | ✔ keep | Covered pages are looked up on our server, and visits to covered Substack/YouTube/LessWrong pages are now counted (anonymously — page address and time, no user or device id). This is a subset of browsing history, so the box stays checked. |
| Websitecontent | ✔ | ✔ keep | Note requests capture the page's title, canonical link, and body text; writing a note captures the selected passage. |
| Nutzeraktivität (user activity) | ✘ | ✔ **add** | New since the Supabase analytics work: the extension records interaction events in our own database — install, notes shown on a page, sign-in started, a vote blocked pending login, a submission rejected by moderation — under a random device id (plus the account id while signed in). Chrome's definition of user activity includes clicks and interaction monitoring, so declaring it is the safe, honest reading even though the events are first-party and coarse. |
| Gesundheitsdaten / Finanz- und Zahlungsinformationen / Private Mitteilungen / Standort | ✘ | ✘ keep | Not collected. |

All three certifications (no selling to third parties, no use unrelated to the
single purpose, no creditworthiness/lending use) remain true and stay checked.

## Firefox note (not part of the CWS form)

The manifest's `data_collection_permissions` for AMO declare
`browsingActivity` as required and `authenticationInfo` +
`personallyIdentifyingInfo` as optional — consistent with the above.

## Privacy policy changes (this PR)

`src/everything-web/public/privacy/index.html` was updated in the same change:

- "Last updated" bumped to 17 August 2026.
- The "no analytics" claim is gone. The policy now describes the self-hosted
  usage events on both the website (pageviews under a random device id) and
  the extension (install, notes shown, sign-in started, moderation
  rejections), including the device id's reset on sign-out and the account id
  on signed-in events.
- The extension section now says the extension installs with access to all
  websites, that visits to covered Substack/YouTube/LessWrong pages are
  counted anonymously, and that note requests store the page's text and
  selected paragraph (and follows store the author's feed address).
- The settings bullet no longer mentions the removed per-site permission
  prompt; it lists the note-type filters and the requested pages/authors
  memory instead.
