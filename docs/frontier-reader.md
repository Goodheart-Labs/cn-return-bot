# Frontier reading page

The Common Notes reading view lives at `/pacing-the-frontier/`. Its own HTML
entry supplies the title and sharing metadata, and Vite builds it for both the
Common Notes domain and the GitHub Pages base path.

The page reads the item for
`https://darioamodei.com/post/we-must-pace-the-frontier` (also accepts the `www`
host) through the shared public data queries. It renders `full_text`, attaches
notes to uniquely matching passages, and keeps unmatched notes accessible.
An item checked only at paragraph scope is not presented as a full essay.

The stored text has no heading markup, so `FrontierReader.tsx` names the
essay's five section titles (`SECTION_TITLES`) and promotes those paragraphs to
headings for the contents rail. The title and date lines at the top of the
stored text are dropped, because the masthead already shows them.

The header links to the extension choices at the end of the page. Those link
directly to the existing Chrome and Firefox store listings. Note cards reuse
Common Notes voting, source details, and improvement flows.

## Writing notes on the page

Every passage long enough to anchor a note carries an "Add a note" button
(visible on hover and focus on desktop, always on phones). Highlighting words
inside a passage turns the button into "Note the highlighted words", and the
note is anchored to those words, widened to whole words. Section titles are
too short to anchor and get no button.

The composer (`components/ReaderWriteNote.tsx`) posts through the same
`postClaimWithNote` call the extension uses, so the note is a user claim with
the anchor as `context_quote` and, new here, the whole passage as
`context_paragraph`. That paragraph is what places the note when the anchored
words recur elsewhere in the essay (`mapNotesToBlocks` falls back to it).
Posting mints the usual anonymous account when the browser holds no session;
the sign-in modal appears only when that is refused. The note posts as a draft
and appears beside its passage as "Needs more ratings", scrolled into view.

## Content status

The public database gained the item on 16 September 2026 (`everything_items`
`77ede0b0-499e-47c3-b220-0b111084fcde`, project `web`, checked at page scope,
55 claims, none of which produced a note). The page therefore renders the
full essay with an empty margin until readers write notes. The page has not
been deployed to commonnotes.net; `bun run commonnotes` serves it locally
against the production backend.

## Local preview and checks

- `bun run commonnotes` and open `/pacing-the-frontier/`.
- `bun run build-everything-web` builds both entry points.
- `bun test src/everything-web/src/lib/readerText.test.ts` checks text structure,
  stable passage links, ambiguous matching, missing content, heading promotion,
  and selection anchoring.
- `./node_modules/.bin/tsc --noEmit` checks types.

Desktop/mobile browser checks use Chrome for Testing or bundled Chromium,
as required by Nathan's global browser rule.
