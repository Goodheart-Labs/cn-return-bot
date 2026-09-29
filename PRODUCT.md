# Product

<!-- impeccable:product-schema 1 -->

This record covers Common Notes: the website at commonnotes.net (`src/everything-web`) and the Common Notes browser extension (`src/everything-extension`), which share one design system (`src/everything-ui`). The X note-writing bot in the same repository is a separate product and is not covered here.

## Platform

web

## Users

Heavy readers and viewers of long-form content: people who read Substack newsletters and LessWrong posts and watch long YouTube videos and podcasts, often every day, for example the audiences of Zvi Mowshowitz, Astral Codex Ten or Dwarkesh Patel. Their first job with Common Notes is to install the extension, so notes appear while they read and watch as usual.

Rating matters most to the product, because ratings decide which notes count as helpful. People do not come to the website just to rate, though. The hope is that readers rate the notes they meet while reading with the extension on. The website is where a note is shared and discussed, and where someone first learns what Common Notes is.

## Product Purpose

Common Notes brings Community Notes to podcasts, newsletters, videos and the wider web. An AI pipeline pulls the factual claims out of a post or a video, checks them against sources, and writes a note where a claim needs context. Readers rate each note as helpful, somewhat helpful or not helpful, and those ratings decide which notes count.

Success is notes seen by many readers at the moment they meet the claim, and rated by enough of them to tell the helpful notes from the rest.

## Positioning

Four things, all true today:

- **Notes inside the page.** The extension shows a note in the article or video itself, next to the sentence or at the moment it is about, instead of on a separate site.
- **AI writes, people rate.** The pipeline writes notes at a scale no volunteer community could, and ordinary readers decide which ones help. Rating needs no expertise.
- **Votes fund charity.** Every rating pledges a small donation from Common Notes to a charity the voter picks (GiveDirectly by default). The pledged amount depends on how the note's rating settles. The money is Common Notes', not the voter's.
- **It follows what you read.** The pipeline checks the creators its readers actually visit, and any page a reader asks it to check.

## Operating Context

- The extension runs in Chrome, Edge and Firefox. It draws notes into Substack, YouTube, LessWrong and the Alignment Forum, and into any other site that has notes. On an article a passage is tinted and a marker opens the note; on a video a card appears over the player while the claim plays. It follows each host page's own light or dark theme.
- The website groups notes by project (usually one creator) and item (one post or video), and each note has a shareable link.
- Reading needs no account. Voting works immediately through an invisible anonymous account; signing in (email code or X) keeps votes and notes across devices.
- Readers can suggest an improved note, argue that a claim needs no note, write their own note on a selection (extension), and ask for a page to be checked.

## Capabilities and Constraints

- Status: alpha, run by Goodheart Labs.
- The website is a static single-page app on GitHub Pages. The extension renders inside shadow roots on other sites' pages.
- Privacy: the extension decides on the device whether a page has notes, so browsing pages without notes contacts no server. Counting visits is opt-in and records no account.
- Terminology: "note", "claim", "project", "item"; rating states "Needs more ratings", "Currently rated helpful", "Currently rated not helpful".
- Undecided: a Safari version does not exist yet; the homepage shows Safari as coming soon.

## Brand Commitments

- The name is "Common Notes".
- The website is light mode (Jim, 2026-09-28).
- No em dashes in any text a reader sees; write two sentences, or use a colon or a comma.
- Common Notes is not X's Community Notes and must not look affiliated with X.

## Evidence on Hand

- About 1,300 published notes on about 115 creators (September 2026), readable on commonnotes.net.
- Store listings: Chrome Web Store (https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij) and Firefox Add-ons (https://addons.mozilla.org/en-US/firefox/addon/common-notes/).
- Logo: `src/everything-ui/assets/logo.svg`, also the extension's icon.
- Three screenshots of the extension at work, the same ones the Goodheart Labs website shows (dark mode, September 2026).
- Awaiting from Jim: the Forethought blog post and the Community Notes TED talk the homepage links to, and the Impressum details.
- Not available and not to be invented: testimonials, press, user or install counts, partner logos. A demo video of the extension does not exist yet; a screenshot stands in.

## Product Principles

- Meet readers where they already read. The note comes to the claim, not the reader to a fact-check site.
- Make rating effortless, and honest to do. Anyone can rate without an account or expertise, and the donation rule rewards rating as you believe, not as the crowd does.
- Earn trust with sources and transparency. Every note carries its sources, and every rating state says what it is based on.
- Be honest about being early. Alpha status, missing platforms and unfinished parts are said plainly.
- Respect the reader's attention and privacy on other people's pages.
