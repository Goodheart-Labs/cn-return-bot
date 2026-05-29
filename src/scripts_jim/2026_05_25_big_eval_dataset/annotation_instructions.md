# big_eval annotation spec (for annotation subagents)

You are fact-checking and annotating Community-Note datapoints for an evaluation dataset used to
hill-climb a note-writing bot. A **separate judge with no other context** will later use your
`judge_guidance` to score whether a freshly-written note is good. So your annotation must be
**self-contained and decisive**.

## Inputs you get
A batch JSON (path given) — an array of datapoints. For each:
- `input_path` → a cached input JSON with `post` (tweet text, author, media) and `botInput`
  (`mediaResult` = an **AI-generated media description that MAY BE WRONG**, `comments` = real replies).
- `note_text` — the ORIGINAL Community Note that was written on this tweet.
- `current_status` — X status of that note (HELPFUL / NOT_HELPFUL / NEEDS_MORE_RATINGS).
- `role`, `needs_note` (provisional), `categories` (provisional), `not_helpful_tag_counts`,
  `dominant_not_helpful_reason`.

## What to do per datapoint
1. **Read** `input_path`. Understand the tweet from its text + comments + the original note's claim.
   Treat the AI media description as a *hint that can be wrong* — corroborate media claims (e.g. "this
   is AI", "old footage") against the note's sources, the comments, and web search, not the
   description alone.
2. **Fact-check** with WebSearch / WebFetch (and the original note's cited URLs): is the tweet's claim
   true / false / misleading? Is a correction genuinely warranted?
3. **Decide `needs_note`** — trust your fact-check over the provisional label:
   - `yes` — a note IS warranted (the tweet makes a checkable, misleading claim a reader benefits from
     correcting), even if the ORIGINAL note did it badly.
   - `no` — note NOT needed. **This is common even among rows tagged as failures**: many "incorrect"
     notes are false positives where the *tweet is actually true* and the *note* is the misinfo. When
     `needs_note: "no"`, set `no_note_reason` to one of:
     `true_claim` (tweet verified true; note denies/contradicts a real fact) ·
     `opinion_or_framing` (only subjective characterization, nothing checkable) ·
     `accurate_reporting_contested` (tweet accurately quotes credible reporting; note injects a
     contested counter-narrative) · `joke_or_meme` · `satire_parody` ·
     `trivial_pedantry` (technically-true nitpick) · `obvious_fake_widely_known` ·
     `insider_reporting_framing` (dispute is over a framing word, not a fact).
   - Whenever your `role`/`needs_note` differs from the provisional one, set
     `disagrees_with_provisional: true` and record `provisional_role`.
4. **Write the fields** (schema below). `judge_guidance` is the most important — concrete, self-
   contained criteria a context-free judge can apply:
   - helpful rows → what a correct note must establish; the reference note shows the bar.
   - failure rows → what a correct note must do **AND** that it must avoid the original note's specific
     failure (e.g. hard-to-understand → "pass only if clearly easier to parse than the quoted
     original"; incorrect → "must not repeat <the false claim>"; missing-key-points → "must include
     <the key point>").
   - no-note rows → "PASS only if the bot declines to write a note; any note here is a false positive."
5. **Keep the taxonomy honest**: set `category_fit` (good/partial/poor) for the provisional
   `categories`; if nothing fits, propose a `suggested_category` (short snake_case). New categories are
   welcome — we refine the map from these.
6. **`media_reliability_flag`**: true if the correct verdict hinges on interpreting media that an AI
   description could get wrong.
7. **`importance`**: rate prominence (high/medium/low) and give a one-line rationale through an
   EA / progress / AGI-safety / animal-welfare lens (does correcting this matter for the world?).

## Output — write `datasets/big_eval/annotations/<tweet_id>.json`
```json
{
  "tweet_id": "...",
  "role": "helpful_reference | unhelpful_<reason> | no_note_needed",
  "provisional_role": "<the role we handed you>",
  "disagrees_with_provisional": false,
  "needs_note": "yes | no",
  "no_note_reason": "",   // required iff needs_note=="no" (see step 3 vocab)
  "categories": ["..."],  // TERRITORY categories (the 13-map); refine freely
  "category_fit": "good | partial | poor",
  "suggested_category": "",
  "tweet_summary": "1-2 sentences: what the tweet claims/shows",
  "why_note_decision": "why a note is / isn't warranted",
  "judge_guidance": "self-contained criteria for a correct note (the key field)",
  "reference_note": "text of a good note (the original note itself for helpful rows; else your model of a correct note, or \"\")",
  "original_unhelpful_note": {"text": "", "failure_reason": "", "original_status": ""},
  "fact_check": {"agrees_correction_needed": true, "claim_verdict": "...", "sources_checked": ["https://..."], "notes": "..."},
  "media_reliability_flag": false,
  "media_confidence": "high | medium | low",
  "importance": {"prominence": "high|medium|low", "lens_rationale": "..."},
  "difficulty": "easy | medium | hard"
}
```
Rules:
- `categories` always tracks the **territory** (the 13-map) and can still fit on a no-note row;
  `no_note_reason` is the separate false-positive axis. `category_fit`/`suggested_category` are about
  the territory categories.
- helpful rows: `reference_note` = the original note; `original_unhelpful_note` = null.
- failure rows (note warranted but written badly): `original_unhelpful_note.text` = the original note
  + `failure_reason` + `original_status`; `reference_note` = your model of a correct note.
- no-note rows (incl. failure rows you reclassify to no-note): `needs_note`="no", set `no_note_reason`,
  keep `original_unhelpful_note` populated (it IS the note that shouldn't have been written), and
  `reference_note` = "".
- `media_confidence`: low when the verdict hinges on media you can't see and the AI description may be
  wrong (the AI description IS wrong sometimes — corroborate, don't trust it).
- Paywalled fetches (CNN/Snopes/NYT often 401/451): route around them via search snippets,
  Lead Stories, AFP/Reuters/AP fact-checks, Wikipedia. Don't block on one source.
- Be concise but complete. Write valid JSON. You are annotating, not writing notes for the bot.
```
