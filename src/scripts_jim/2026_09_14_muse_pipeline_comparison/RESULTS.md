# The everything pipeline on Muse, old versus new, on one item (GOO-159)

Test item: Nicholas Decker, "The Consequences of Caste in Village India"
(`8764d17a-b65c-4789-b0d7-99339f69260f`, Substack, 42,599 characters, published
2026-07-02). The old pipeline processed it on 2026-08-27: 181 claims extracted
by Opus 5, 24 of them rated uncertain and checked, 2 notes written, both since
rated helpful by readers.

Method: `compare.ts` runs the new steps in-process on the stored inputs and
writes six files under `results/<item-id>/`, old and new for each step, each
carrying the identical input so the pair lines up. Nothing was written to the
database. OpenRouter calls went through `OPENROUTER_TESTING_KEY`. The new
per-claim checks ran from this VPS, where X's evaluate-note scoring endpoint
answers 403; that gate was skipped, so a "candidate" here is one gate short of
what prod would apply.

## Summary table

| Step | Old (Opus 5 / Sonnet 5 / Gemini) | New (Muse) | Cost old | Cost new |
|---|---|---|---|---|
| Extraction, 12,000-char chunks (shipped) | 181 claims | 347 claims, 1 part, 2 trivially true | not recorded | $0.044 |
| Extraction, one 200,000-char call (experiment) | 181 claims | 80 claims | not recorded | $0.028 |
| Rating of the same 181 claims | 24 to check | 35 to check, 111 identical judgements | not recorded | $0.007 |
| Check of the same 24 claims | 2 notes | 2 notes (one of them new), two runs: 1 note $0.32, then 2 notes $0.36 | $2.78 | $0.32 to $0.36 |

The whole item would cost well under a dollar on Muse. The old check step alone
cost $2.78, and the old extraction and rating were never recorded but ran on
Opus at roughly fifty times Muse's token price.

## Extraction: the chunk size matters more than the model

The gate and split call said the essay is checkable and chose not to split it
(`probeSplit.ts`, two runs, both an empty part list). That is the right answer
for a single-topic essay, so the whole 42,599 characters formed one part.

The plan first raised the chunk limit from 12,000 to 200,000 characters, so
that a part would be one call. That one call found **80 claims**. The same
model on the old 12,000-character chunks (four calls) found **336**, and on a
second run with the flag below **347**. Opus on the old chunks had found 181.
So one long call summarises where several short calls stay exhaustive, which
is exactly why the 12,000 limit existed, and Jim put it back. Muse with short
chunks is far more thorough than Opus was, at about four cents an item.

Each claim now also carries `trivially_true`, which the extractor sets when it
is extremely confident the claim is correct as stated. Such a claim is stored
as skipped and never rated or checked. On this item the model set it on 2 of
347 claims, both textbook genetics ("when new gametes are formed through
meiosis, chromosomes are chopped up and reassembled"), so it is conservative.

The splitter itself was validated on Zvi's "Monthly Roundup #44: July 2026",
which is a list of unrelated sections: the model returned 17 parts, every start
sentence was located, the cut matched the post's own section headers, and two
runs gave the same 17 parts (`probeSplit.ts 4b776e7a-5475-4cf9-8f4b-aaf42e25ae55`).

## Rating: cheap, mostly agreeing, but it lets both noted claims through

The new rater read the whole text and all 181 stored claims in one call, made
16 Google searches and no page fetches, and answered in 141 seconds for $0.007.
Its judgement matched the old one on 111 of 181 claims. It sends 35 claims to
the check instead of 24, but they are largely a different 35: of the 24 the old
rater flagged, 9 stay flagged and 15 are now "likely true"; 26 claims the old
rater called "likely true" are now "uncertain".

**The two claims that earned helpful notes are both rated "likely true" by the
new rater and would never be checked:**

| Claim | Old | New |
|---|---|---|
| "the open defecation rate in rural India remains around 28%" | uncertain | likely true |
| "Around 35% of children in Uttar Pradesh attend private schools" | uncertain | likely true |

The research text shows what went wrong on the first: the rater found the
"28 percentage-point decline between NFHS 2015-16 and 2019-21" and then
accepted "around 28%" as the level. The old note corrected exactly that
confusion. The second is a plain miss: 35% is well below the current figures
(51.7% in 2024-25).

This is the one result in the comparison that argues against shipping the
rating step as it stands. Three ways to respond, in increasing cost:

1. Tighten the prompt: tell the rater that a figure it cannot confirm with a
   source is "uncertain", never "likely true" from general knowledge. Free to
   try, unproven.
2. Lower the check bar: check "somewhat likely true" or worse. On this item
   that adds 10 claims; the two noted claims would still be missed, because
   they were rated "likely true", so this does not solve it alone.
3. Keep rating on a stronger model. Opus rated this item once for a few dollars;
   Sonnet 5 with Claude's tools would be the middle ground.

The per-part design was not exercised here, because the essay did not split.
On a split post each part's rater sees a few thousand characters and a dozen
claims instead of 42,599 characters and 181, which should help; that is the
next thing to measure, on the Zvi roundup.

## Check: eight times cheaper, one note kept, one lost at verification, one new

The same 24 claims were re-checked on Muse for search, writer and verifier,
twice (the second run also records each note draft and the verifier's reply).
Cost was $0.32 and then $0.36 against $2.78 before, about 1.5 cents a claim
against 12 to 37 cents. 21 of the 24 came back "no correction needed" in every
version, which is the expected shape: the old rater had flagged them as
uncertain and the check found them fine.

The private-school claim got a note in both runs, with different and better
sources than before (the 2024-25 Project Approval Board figure of 51.7%, and in
the first run the ASER rural survey). The second run also wrote a note the old
pipeline never did, on the claim about caste in elite hiring: it quotes the
Shukla paper itself, verified with three supporting passages.

The open-defecation claim, a helpful note before, was **lost at the source
verifier in both runs**. The search found the right evidence both times
(WHO/UNICEF JMP 11% in 2022, World Bank 6.7% in 2024, NFHS-5 19% of
households) and the writer drafted a correct note. But the writer cited an
NDTV page that failed to fetch and the World Bank indicator page, which
renders its numbers only in the browser, so the verifier had no text
supporting the figures and answered no. That verdict is right for the sources
it was given; the miss is the writer choosing sources that do not survive a
plain fetch. The old run's writer cited Trading Economics and a news article,
which did. Claim 24 produced an empty draft and failed verification in the old
run and in both new runs.

## What to decide

- Rating: whether Muse is acceptable as the rater given it would have dropped
  both helpful notes here, or whether the rater is the one step to keep on a
  stronger model.
- Writer sources: the lost note is a writer that cites pages the verifier cannot
  read (a failed fetch, a JavaScript-only page). Whether that is noise or a
  pattern needs more items; the harness takes any item id.

## Files

- `compare.ts`: the harness. `bun run src/scripts_jim/2026_09_14_muse_pipeline_comparison/compare.ts [<item-id>] [--steps extraction,rating,check]`
- `probeSplit.ts`: shows the gate and split verdict for an item and whether the cutter can locate every start.
- `results/8764d17a-.../extraction.{old,new}.json` (new = 12,000-character chunks with the flag), `extraction.new.chunked12k.json` (the first 12k run, before the flag), `extraction.new.onecall200k.json` (the one-call experiment), `rating.{old,new}.json`, `check.{old,new}.json`.
