# One-off scripts

Scripts here were each run once (or a handful of times) to catch up existing
data or seed a project. They are kept for reference and re-runnability, but the
live pipeline should not depend on them. Each entry notes whether the pipeline
now covers the same capability generally.

## `backfillContextParagraph.ts`

Backfilled `everything_claims.context_paragraph` — the wider verbatim passage
the claim's `context_quote` sits in — for claims that had a note but no
paragraph, by re-fetching each item's source (transcript cues around the
timestamp span for YouTube; the surrounding text block for articles).

**Superseded.** The extractor now emits `context_paragraph` directly
(`extractClaims.ts` → stored by `processContent.buildClaimRow`), so every new
claim carries it. This was a one-time catch-up for rows created before
migration 052 added the column.

## `backfillFullText.ts`

Backfilled `everything_items.full_text` — the complete article text the public
"write / improve a note" flow searches (`WriteNoteModal`) — for items with a
null `full_text`, by re-fetching and stripping the HTML.

**Not yet general — this is a real gap.** The live worker/importer path does
*not* persist `full_text` on ingest, so newly-queued items still land with
`full_text = null` and are un-searchable in the write-note UI until this script
is re-run. The clean fix is to have the source fetch (`sources/substack.ts`,
`sources/youtube.ts`) return the full plain text and `processContent` store it
on the item alongside the claims — then this backfill can be deleted.

## `importDwarkesh.ts` (+ `dwarkesh_clips/`)

One-time import of hand-curated Dwarkesh Podcast clip-notes (vendored as
`dwarkesh_clips/*.json`, one per clip: note text, claim, verbatim context, exact
YouTube `[start, end]` span) into the `dwarkesh` project.

**Superseded.** The general additive importer `importClaimResults.ts`
(`bun run everything-import-claims`, PR #261) imports any podcast claim-pipeline
run verbatim-gated, which covers this use case. The Dwarkesh clips were a
bespoke pre-pipeline dataset; new podcast runs should go through the general
importer instead.
