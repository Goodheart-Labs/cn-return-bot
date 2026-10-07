# How the Common Notes extension behaves

This document describes what a reader sees and can do with the Common Notes browser extension (`src/everything-extension/`). It also records the product decisions behind that behaviour, in the last section. If something here looks like a bug or an oversight, check that section first, because several of these choices were made on purpose.

It is a behaviour spec, not a code walkthrough. Each paragraph ends with the file that implements it.

A few words used throughout:

- A **content script** is extension code that the browser runs inside a web page (a standard browser-extension term). Our content scripts find the notes for the page and draw them.
- The **background** is the extension's own long-lived script, a service worker in Chrome's terms. It owns the right-click menus, the periodic sync with our database, and every write that must happen in one place.
- A **covered page** is a page that has a row in `everything_items`, so the pipeline or a reader has put notes on it (a codebase term).
- A creator's **priority window** is the 7 days after someone asks us to check that creator's new posts (a codebase term; the code calls the request a "press"). While it is open, the pipeline checks every new post by that creator.

## Where notes appear

When you open a Substack post or a YouTube video, the extension looks for notes on it. Those two sites are listed in the extension's manifest, so the extension runs there from the moment it is installed. (`entrypoints/notes.content.ts`, `entrypoints/youtube.content.tsx`, `utils/staticSites.ts`)

Every other site that has notes is picked up while the extension runs. Every 5 minutes, and whenever you open the popup, the background downloads the list of covered pages. For each new hostname on that list, it tells the browser to run our generic content script on that site from now on. It also injects the script straight into tabs that are already open on that site. So a newly covered site reaches every existing install without a store update. (`entrypoints/background.ts` `syncNotedSites`, `entrypoints/generic.content.ts`)

On a covered page, each claim's passage is found in the page text by fuzzy matching. The extension tries the claim's updated quote first, then its quote, then its wider paragraph. When a quote has drifted slightly, it matches only the first and last 6 words. (`utils/anchorGroups.ts`, `utils/anchor.ts`)

Substack's own reader links, such as `substack.com/home/post/p-<id>` and `substack.com/@author/p-<id>`, do not contain the publication's post address. The background resolves them with a fetch that carries no cookies. A home-feed link answers with a redirect to the real post. A profile link answers with a page that names the real post in its `canonical_url`. The answers are cached. This is why notes and listing badges also work in the Substack home feed and on profile pages. (`utils/readerCanonical.ts`, `fetchReaderCanonical` in `src/everything-core/pageUrls.ts`)

If our database cannot be reached, the page shows nothing. It never pretends that a page is unchecked during an outage. (`utils/mountInlineNotes.tsx`)

The notes follow the page's light or dark theme, so a dark Substack gets dark notes. (`utils/pageTheme.ts`)

## How notes show on an article page

### Display choices per status

Every note has one of three statuses: rated helpful, needs more ratings, or rated not helpful. For each status you choose how its notes show:

- **Open**: the note's card is on screen without a click.
- **Collapsed**: a marker beside the passage and a tint over the passage. A click on either opens the card.
- **Dot only**: the marker alone, with no tint. Only a click on the marker opens the card.
- **Hidden**: nothing on the page.

By default, helpful notes are open, notes that need ratings are collapsed, and not-helpful notes are dot only. One claim can hold several notes. It shows in the most prominent choice among its notes, so a claim with one open note is open. (`utils/settings.ts` `DEFAULT_NOTE_DISPLAY`, `utils/claimGroups.ts`, `components/NoteDisplayChoices.tsx`)

### Marker colours

Each marker takes the colour of the best status among the notes on its passage. Green means helpful, blue means it needs more ratings, and red means not helpful. These are the same colours as the status dot on the note card. (`utils/claimGroups.ts`, `utils/markerPalette.ts`)

### Margin cards and the 200 px rule

By default, markers sit in the right margin beside the text, and a card opens in the margin in its marker's place. This is the **margin style**. Overlapping cards are pushed down so they stack. A card that opens by itself only does so if, after that push, it sits at most 200 px below its passage. Further down it would sit beside unrelated text, so its claim keeps just its dot until you click it. A card that you opened is always shown. (`utils/marginCards.ts`, `components/InlineNotes.tsx`)

When the window is too narrow for a 300 px card, or the page clips its margin, the extension falls back to the **classic style**: a badge at the end of the passage and a popover over the text. You can also pick the classic style in the settings. In the classic style an "open" note behaves like a collapsed one. (`components/InlineNotes.tsx`)

### Opening and closing cards

Every card has a close button. A card that opened by itself closes only through that button. Cards you open yourself behave differently: you see one at a time, and a click elsewhere on the page or opening another card closes it. (`utils/cardChoices.ts`)

When you close a card with its close button, it stays closed on later visits until you open it again. The list of closed claims is kept on your device. (`utils/closedNotes.ts`)

For screen readers, a card you opened is a dialog, and a card that opened by itself is a side note. Both are named after the start of their quote. (`components/InlineNotes.tsx`)

### The top bar

Every card starts with a top bar. On the left is a counter such as "2 of 3". Clicking it opens the page's next claim, in reading order, and wraps around at the end. On the right is the close button. On a page with only one claim the counter is left out. (`NextNoteButton` in `components/ClaimNoteStack.tsx`)

Notes refresh in place. A vote, a new note or a deletion anywhere on the page updates the markers at once. (`utils/mountInlineNotes.tsx`)

## YouTube

On a covered video, small pins on the scrub bar mark each claim, coloured by status. A note card appears over the video while playback is inside the claim's part of the video. It fades out a little after playback leaves that part, unless you are interacting with it. Only claims set to open pop up on their own during playback. Any other claim shows its card when you click its pin or step to it with the "2 of 3" counter. (`components/YoutubeOverlay.tsx`, `components/ScrubberPins.tsx`)

The card can be dragged and resized like a desktop window, and the next card on the same video opens where you left the last one. Dismissing a card hides it only while playback stays in that claim's part. If you seek back into it, the card shows again. YouTube does not use the remembered closed-card list. (`components/YoutubeOverlay.tsx`, `components/FloatingWindow.tsx`)

## Listing badges

On a listing, such as a Substack front page, a YouTube channel's videos tab, or a list of articles on another site where the extension runs, every card that links to a covered page gets a small circle in the upper-right corner of its picture. If there is no picture, the circle goes in the card's corner. The circle shows the number of notes that you have not set to hidden. A page we read in full and found nothing to note on gets the same circle with a check mark. The counts come from the list the background synced, so drawing badges sends nothing to our server. You can turn badges off in the settings. (`utils/coverageBadges.ts`)

On YouTube the circle sits in the upper-left corner of the thumbnail instead. When you hover a thumbnail, YouTube shows its "Watch later" and "Add to queue" buttons in the upper-right corner, on top of anything we put there.

The circle grows a little under the mouse. A click on it does not open the post. It opens a small card under the circle with the popup's own sentence for that page: "We checked this post and found nothing to note" or "3 Common Notes on this page". The card names no author, because the synced list does not know authors. A second click on the circle closes the card. So does a click on empty page surface, the same rule that closes an open note (`listenForDismissingClicks` in `utils/inertClick.ts`), as well as Escape and scrolling. (`components/BadgeCard.tsx`, `utils/mountBadgeCard.tsx`)

Links in written text get no circle, because they are part of what someone wrote, not an entry in a listing. That covers links inside an article, a comment or a Substack note: a link surrounded by much more text, a link that shows its own web address, and a link nested inside another link, such as a link inside an embedded note. A preview box that is a link by itself, such as the quote a Substack note shares from a post, gets the circle in its own corner. Before, a note's circle went to the note's largest picture, which could be an unrelated screenshot.

## The popup

The popup is the window that opens from the extension's toolbar button. It starts with one sentence about the current page. Examples: "2 Common Notes on this page, 1 needs more ratings", "We checked this page and found nothing to note", or "We haven't checked this page yet". The counts include every note, whatever your display choices. While at least one note is not hidden, the sentence is a link that jumps to the next note. (`entrypoints/popup/App.tsx`, `utils/pageStatus.ts`)

Below the sentence, the popup can show two buttons.

- **The request button** asks us to check this page. It shows only on content pages that we have not read in full. On YouTube, Substack and LessWrong it shows only on a video or a post, never on a channel page, inbox or profile. It never shows on search engines. On a page with no item it says "Request notes on this page". On a page that has an item only because a reader wrote a note or one paragraph was checked, it says "Check this page". If the page's creator is in their priority window, the button is replaced by a sentence such as "We're checking this author's new posts this week." (`utils/pageShape.ts`, `entrypoints/popup/App.tsx`)
- **The creator button**, for example "Check this author's new posts", gives the page's creator a 7-day priority window. It shows on any page that belongs to a creator whose window is closed, whether the page has notes or not. Creators are recognised on Substack publications including custom domains, Substack profiles, YouTube channels and watch pages, and LessWrong and Alignment Forum authors. (`utils/authorFeed.ts`, `utils/creatorTarget.ts`, `utils/prioritizedCreators.ts`)

After you request a page, a small progress card appears in the page and follows the check until its notes are written. New notes appear on the page as they arrive, without a reload. The card comes back if you navigate away and return, for up to a day. The popup shows the same progress in text. (`utils/requestLive.ts`, `components/RequestProgressCard.tsx`, `utils/liveRequests.ts`)

A request sends the page's text, which the extension reads on your device. This lets the pipeline check pages it cannot fetch itself. (`utils/pageCapture.ts`)

The popup's footer links to the settings page and unfolds the feedback links.

## Right-click menus

The right-click menu (browsers call it the context menu) has three Common Notes entries, on every page:

- **Request Common Notes on this**, over a selection. It asks us to check only the selected text.
- **Request Common Notes on this page**, on a plain right-click.
- **Write a Common Note on this**, over a selection. It opens the note editor on the selected text.

A request is not sent when it is not needed. If the page has already been read in full, a small card in the page says "This page has already been checked." If the page's creator is in their priority window, the card says we are already checking their new posts this week. A page that has an item only because of a reader's note or a checked paragraph still accepts the request. A sent request starts the progress card described above. On a page that cannot show a card, such as a browser settings page, the toolbar icon flashes a tick, or an exclamation mark when the request failed. (`entrypoints/background.ts` `requestNoteOnSelection`, `utils/requestInfo.ts`, `components/StatusOverlay.tsx`)

Writing works on any website. On a page we do not cover, the click gives the extension temporary access to that tab (Chrome's **activeTab** permission), which lets it start the note editor there. The page's item is created only when you post. Once you post, the page becomes covered and your note appears straight away. (`utils/mountWriteAnywhere.tsx`, `ensureWebItem` in `src/everything-core/items.ts`)

## Privacy

**Whether a page has notes is decided on your device.** The background keeps a local copy of every covered page address. A content script checks the page against that copy before it makes any request to our server. Ordinary browsing on a page without notes therefore never contacts our server. Only on a fresh install, before the first sync has finished, does the extension ask the server directly. (`utils/coveredPages.ts`, `utils/mountInlineNotes.tsx`)

**Visit recording.** When you open a post or video on Substack, YouTube, LessWrong or the Alignment Forum, the extension can save one row saying which link was opened and which creator it belongs to. This happens whether or not the page has notes, because the counts tell the team where notes are needed. The row carries no account. It does carry a **reader hash**: a hash of a random secret that exists only on your device, combined with the creator's feed address. That gives one value per browser and per creator. The team can count how many different people read a creator, but the rows about two creators cannot be joined into one person's reading. The secret is never sent anywhere and is not replaced when you sign out. Only the background writes these rows. (`utils/linkVisits.ts`, `utils/visitReader.ts`, `src/everything-core/readers.ts`)

**Recording starts only after you were asked.** After a fresh install, the background opens a welcome tab once. It explains Common Notes and asks whether we may save the posts you visit. Nothing is recorded until that question has been answered or you have opened the settings page. The flag is `cn:welcomeSeen`. An install that went through the older settings-page onboarding (`cn:settingsOnboardingDone`) is treated as already welcomed. After that, recording follows the per-site checkboxes. (`entrypoints/welcome/App.tsx`, `entrypoints/background.ts`, `utils/settings.ts`)

Usage events, such as "installed", a once-a-day "active" signal, and "notes shown", are sent with a random device id and are not gated on the welcome question. (`utils/analytics.ts`)

## The settings page

The settings page opens from the popup. It contains:

- On Safari only, how to allow Common Notes on every website.
- One checkbox for sharing which posts you open. It stands for all three site kinds at once.
- Your account: sign in, or the email you are signed in with and a sign-out button.
- Feedback: a feedback form and two call-booking pages, one for US hours and one for European hours (`utils/feedbackLinks.ts`).
- Advanced settings, folded away: the listing badges on or off, margin or classic style, the display choice for each status, the rating button colours (colourful by default, or all blue), and the per-site visit checkboxes.

(`entrypoints/options/App.tsx`)

Most settings are stored in the browser's synced storage, so they follow you across devices. A write stores only the keys you changed. A setting you never touched therefore stays absent and follows its default, so when we change a default it reaches you too. (`patchSyncObject` in `utils/settings.ts`)

## Signing in

You can vote and write notes without signing up. The first time you do, the extension quietly creates an **anonymous account**, a Supabase account with no email, for this browser. If you sign in later, that account is upgraded in place and keeps your votes and notes. A browser that has held a real account before does not get an anonymous one. It asks you to sign in instead, so your activity is not split across two accounts. (`ensureUser` in `src/everything-core/auth.ts`, `src/everything-features/auth/useActingUser.ts`)

There are two ways to sign in. With email, you type your address and then the 6-digit code we email you, with no link to click. With X, a login window opens. The sign-in form lives on the settings page. It also folds into a note card when you need to sign in to vote or write, so you are never sent to the toolbar. A half-finished email sign-in is remembered for an hour, so you can switch to your mail and come back. (`components/LoginPanel.tsx`, `components/OverlayLoginGate.tsx`, `src/everything-features/auth/SignInForm.tsx`)

## Safari

Safari loads an extension only from inside a Mac app, which we build from `src/everything-extension/safari/`. Three things differ for a Safari reader:

- **Site access.** Safari grants no website at install. You allow sites from the extension's toolbar button, and until you do, the extension shows nothing there. The welcome page and the settings page tell you to choose "Always Allow on Every Website". They have no button, because Safari ignores an extension's own request for that access. (`components/SafariSiteAccess.tsx`)
- **Sign-in.** Safari has no way to run the X login window, so only email sign-in is offered. (`components/LoginPanel.tsx`)
- **Settings do not sync** across devices, because Safari's synced storage behaves like local storage.

## Deliberate decisions

Each entry says what we chose, why, and when. Please do not undo one of these without asking Jim.

- **There is no way to hide notes on one site.** Notes show on every site that has them. A "Hide notes on this site" switch existed for two days and was removed on Jim's call. (2026-08-17)
- **Access to every site is required at install.** It replaced a flow where you granted each site separately. That flow meant a newly covered site showed nothing until you granted it. Now a new site goes live on every install through the sync. Chrome disabled existing installs on that update until the reader approved the wider permission. (2026-07-30 and 2026-08-15)
- **No in-page cards offer a request or a creator follow.** Those cards were removed in GOO-71. Before that, each one showed only once per page or per creator. The popup and the right-click menu are now the ways to ask. (2026-08-31)
- **The note-count card is gone.** It was removed in GOO-242, when the coloured markers and the per-status display choices arrived. The only in-page cards left are the request confirmation and the request progress card. (2026-09-29)
- **No request is offered for content we already handle.** A page read in full, or a page whose creator is in their priority window, gets no request button. The right-click request answers with an explanation instead. A page that has only a reader's note or a checked paragraph can still be requested. The request button also shows only on posts and videos, not on channel pages, inboxes or profiles. (2026-08-25)
- **An outage shows nothing.** If our server cannot be reached, the page and the popup do not claim that a page is unchecked or offer a request for it. (2026-08-25)
- **Visit recording is inert until the reader was asked.** First this was the settings-page onboarding (2026-08-18). Since GOO-62 it is the welcome tab's question (2026-08-31). Visits are counted on pages without notes too, because those counts show where notes are needed.
- **Visits carry a per-creator reader hash, never one id per reader.** This lets us count readers per creator while keeping a person's reading across creators unlinkable. (GOO-135)
- **Default display: helpful open, needs ratings collapsed, not helpful dot only.** This was Jim's call when the per-status choices replaced two checkboxes. Everyone started from the new defaults once. (GOO-239, 2026-09-29)
- **A card opens by itself only within 200 px of its passage.** A card further away would sit beside unrelated text. (2026-09-29)
- **A closed card stays closed on later visits**, and a card that opened by itself closes only through its close button. You see only one card you opened at a time. (2026-09-29 and 2026-10-01)
- **Settings writes store only the keys you changed.** Writing the whole merged settings object kept the note-count card switched on for early installs after its default changed. (2026-09-29)
- **Margin style is the default.** The note opens beside the text instead of on top of it. (GOO-66, 2026-08-31)
- **You can vote and write without signing up**, through anonymous accounts (GOO-64). A browser that has signed in before must sign in again rather than get a second, anonymous account. (2026-08-31)
- **Safari offers email sign-in only, and its access prompt has no button.** Safari cannot run the X login, and it ignores an extension's own request for site access. (2026-09-30)
- **Development builds reload themselves.** A dev build checks every 30 seconds whether a newer build has landed on disk and reloads if so. This replaced a check that opened a probe tab in Jim's browser and pulled his laptop's focus to Chrome, which he asked to be rid of. (2026-08-25)
