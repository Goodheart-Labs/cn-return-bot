# big_eval HANDOFF — start here in a fresh session

Single entry point for resuming the big_eval dataset build. Read this top-to-bottom before any
action; then read [CATEGORIES.md](CATEGORIES.md) (taxonomy), then the annotation spec at
[src/scripts_jim/2026_05_25_big_eval_dataset/annotation_instructions.md](../../src/scripts_jim/2026_05_25_big_eval_dataset/annotation_instructions.md),
then the operational README at [src/scripts_jim/2026_05_25_big_eval_dataset/README.md](../../src/scripts_jim/2026_05_25_big_eval_dataset/README.md).
The full strategic plan is at `~/.claude/plans/hi-claude-i-have-memoized-waffle.md`.

## What this is (1-min summary)

A ~500-row, richly-annotated Community-Notes eval dataset for hill-climbing a new notewriter bot.
Each row carries **self-contained `judge_guidance`** so a context-free Opus judge can score new notes
strictly, *and* (for failure rows) check the new note avoids the original note's specific failure.
**Target: ~50% `needs_note=no`** — false-positive suppression is the top priority. Source corpus =
all notes from 12 AI-notewriter author IDs (in `ai_author_ids.txt`) parsed from X's public dump.

## Current state (as of this handoff)

- **Branch:** `feature/big-eval-dataset` (already pushed to origin).
- **Selection:** 745 rows in `selected.jsonl` (495 original + 250 no-note booster from the cleaner
  dominant-`notHelpfulNoteNotNeeded` pool).
- **Cached inputs:** 657 of 745 (~88 tweets deleted/inaccessible — expected attrition); each in
  `inputs/<tweet_id>.json` with `post`, AI media description (which **MAY be wrong**), comments.
- **Annotations: 455 of 657 done.** Still TODO: **~202 datapoints**.
- **Distribution so far:** 279 needs-note / 176 no-note (≈39% no, climbing toward 50%).
  Of the 455, **182 (40%) flipped from the provisional label** — both directions, but mostly
  `failure → no-note` (false positives on true tweets) and the booster's `no-note → needs-note` (the
  community signal was still noisy). Assembly will cap to ~50/50.
- **Watcher:** `usage_watch.py --ceiling 93` running (pause at ~$70).

## Key findings — context the fresh session needs

1. **"Note rated incorrect/missing-key-points" is NOT a clean failure signal.** Many such notes are
   *false positives on TRUE tweets* — the *note* is the misinformation. The annotation step splits
   each into (A) tweet genuinely needed a note but the note botched it → `needs_note=yes` with a
   corrected reference note, or (B) tweet was fine → `needs_note=no` with `no_note_reason` set.
   ~40% of failure-bucket rows flip to (B).

2. **AI media descriptions are routinely wrong.** Treat the cached `botInput.mediaResult.tweetMedia`
   description as a *hint*; corroborate against the note's cited URLs, comments, and web search.
   Real failures we've seen: the AI desc said "B-2 Spirit" when the photo is a B-21; called real
   Gaza footage AI; mis-named a real tunnel. Annotators must set `media_confidence: low` when the
   verdict hinges on media they can't see.

3. **Recurring viral events dominate** (Netanyahu death-hoax, Iran/Israel war, Epstein, Maduro
   capture, Alex Pretti). Selection deduped via a 5-longest-word signature; assembly will dedupe by
   `tweet_id` (5 tweets carry >1 selected note → 6 collisions; tweet-id keying takes last-writer-wins,
   which we accept).

4. **No-note sourcing is harder than the budget assumed.** The first selection's NMR+weak-signal
   no-note bucket yielded only ~40% genuine no-note. The booster (dominant `notHelpfulNoteNotNeeded`
   from NOT_HELPFUL notes) yields better but still ~60-70% no-note. To hit a 50% target, **plan to
   CAP excess `needs_note=yes` rows at assembly** rather than expecting natural balance.

5. **Taxonomy is now v2.** I consolidated the ~180 subagent-suggested categories — 13 originals plus
   5 new (`joke_or_satire`, `real_media_falsely_called_ai`, `antisemitic_conspiracy`,
   `legal_or_court_claim`, `fabricated_quote`). See the v2 section of [CATEGORIES.md](CATEGORIES.md).
   New annotations should use v2; Phase 6b normalizes the 455 already-done.

## Budget rules

User explicitly capped at **$70 per 5h block** (after observing 75%-of-$124-ceiling = 97% of real
limit was too aggressive). Real subscription block limit appears to be ~$96, so $70 ≈ 73% of real.

- Watcher must run with `--ceiling 93` (pause at ~$70).
- Each round of 8 parallel subagents × 12 datapoints costs ~$15–20 of token-budget; expect to fit
  2–3 rounds per block before PAUSE.
- **This conversation's huge context inflated dashboard usage ~1.5–2× vs ccusage's per-token math.**
  Always run from a fresh small-context session for cheaper grinding (this very handoff is a fresh
  start).
- **Important watch-out:** when the user is awake, respect the $70 cap so they have headroom for
  their own Claude Code use. When the user is asleep, they may permit higher.

## How to run — exact commands

```bash
# 0. Restart the usage watcher (idempotent; safe to run any time)
pkill -f usage_watch.py 2>/dev/null; sleep 1; rm -f datasets/big_eval/PAUSE
nohup uv run src/scripts_jim/2026_05_25_big_eval_dataset/usage_watch.py \
  --interval 120 --ceiling 93 > datasets/big_eval/usage_watch.log 2>&1 & disown

# 1. Status / progress
uv run src/scripts_jim/2026_05_25_big_eval_dataset/06_prep_batch.py --status
uv run src/scripts_jim/2026_05_25_big_eval_dataset/usage_watch.py --once --ceiling 93

# 2. Prep N non-overlapping batches of size 12 (skips already-annotated)
uv run src/scripts_jim/2026_05_25_big_eval_dataset/06_prep_batch.py --count 8 --size 12

# 3. Dispatch 8 PARALLEL Agent (general-purpose) subagents in ONE assistant turn,
#    one per batch_0..batch_7. Use this dispatch prompt verbatim for each subagent:
#
#    """
#    Annotate Community-Note datapoints for an eval dataset. Work from repo root
#    /Users/jimmaar/Github/cn-return-bot.
#    1. Read and follow EXACTLY:
#       src/scripts_jim/2026_05_25_big_eval_dataset/annotation_instructions.md
#    2. Read datasets/big_eval/CATEGORIES.md for the v2 territory categories.
#    3. Read your batch: datasets/big_eval/_cache/batch_<N>.json.
#    For EACH: read its `input_path`, fact-check the claim with WebSearch/WebFetch +
#    the note's cited URLs (route around paywalls), then WRITE
#    datasets/big_eval/annotations/<tweet_id>.json with the FULL schema
#    (provisional_role, disagrees_with_provisional, no_note_reason, media_confidence).
#    judge_guidance is the key field — self-contained; failure rows must require
#    avoiding the original note's specific failure; no-note rows set no_note_reason
#    and require the bot to decline. Only flip a tweet to "true/no-note" when web
#    evidence clearly confirms it.
#    Reply briefly: (a) count written, (b) flips + why, (c) new category suggestions,
#    (d) blockers.
#    """

# 4. After subagents return:
git add datasets/big_eval/annotations/
git commit -q -m "big_eval: +N annotations (round X)"
git push -q origin feature/big-eval-dataset

# 5. Repeat 2-4 until ready==0 OR datasets/big_eval/PAUSE exists.
```

## Phase 6b — taxonomy normalization (after annotation finishes)

The v2 territory map is locked in [CATEGORIES.md](CATEGORIES.md). The 455 already-done annotations
were written under the v1 13-map + `suggested_category`. To normalize:

1. Write `src/scripts_jim/2026_05_25_big_eval_dataset/07_normalize_categories.py`:
   - Read each `annotations/<id>.json`.
   - For each `categories` entry not in the v2 vocab (13 originals + 5 new), map it to the closest
     v2 category using this mapping table (extend as needed):
     - any `fabricated_quote*`, `fake_*_quote`, `paraphrased_quote_as_mockery`,
       `stale_quote_recycled_as_recent`, `shitpost_quote_in_quotes` → `fabricated_quote`
     - any `joke_or_*`, `satire_*`, `*_joke`, `*_meme`, `april_fools_joke`,
       `christmas_santa_joke`, `obvious_satire_*`, `obvious_joke_meme`, `japanese_internet_meme`,
       `in_jokes_and_callouts`, `fictional_universe_joke`, `ironic_caption_meme`,
       `sarcasm_or_commentary`, `sarcastic_meme_post`, `persona_satire_on_real_controversy`,
       `labeled_parody_account`, `satire_mistaken_as_real`, `wry_commentary_on_real_event`,
       `obvious_visual_joke` → `joke_or_satire`
     - `real_footage_falsely_called_ai`, `authentic_nasa_panorama`, `accurate_reporting_of_ai_image`,
       `falsely_debunked_real_media` → `real_media_falsely_called_ai`
     - `antisemitic_*`, `false_flag_conspiracy`, `antisemitic_conspiracy_9_11` → `antisemitic_conspiracy`
     - `court_case_legal_claim`, `false_legal_outcome_claim`, `fabricated_legal_or_court_claim`,
       `contested_legal_*`, `constitutional_law_misstatement`, `legislative_vote_misframing`,
       `mischaracterized_legal_status`, `unproven_criminal_accusation_stated_as_fact`,
       `fabricated_arrest_claim` → `legal_or_court_claim`
     - `fabricated_poll*`, `fabricated_statistic`, `viral_economic_claim`,
       `misleading_political_statistic`, `misleading_methodology_or_metric` →
       `statistical_or_numerical_claim`
     - `chemtrails_*`, `space_fakery_conspiracy`, `religion_prophecy` → `conspiracy_and_viral_hoax`
     - `chemical_scaremongering`, `antivax_conspiracy_misinfo`, `popsci_oversimplification`,
       `biologically_impossible_claim`, `viral_lifehack_misinformation`,
       `scientific_illiteracy_rage_bait`, `climate_environment_misinfo` →
       `health_medical_science`
     - `fabricated_screenshot_of_post`, `fabricated_compromising_photo`, `fabricated_price_tag`,
       `forged_official_document`, `fake_data_visualization`, `unverified_anonymous_leak`,
       `unfounded_inauthenticity_accusation` → `manipulated_or_fabricated_evidence`
     - `old_footage_*`, `outdated_*`, `historical_reenactment_account`,
       `ai_colorized_historical_footage`, `missing_temporal_context`,
       `miscontextualized_fiction_as_statement`, `wrong_location_attribution`,
       `wrong_country_location_swap`, `conflated_locations_or_entities`,
       `identity_misattribution`, `ethnic_misattribution`, `impersonation_or_fake_account` →
       `misattributed_or_miscontextualized_media`
     - `engagement_farming_*`, `fabricated_personal_story_*`, `fabricated_announcement`,
       `fabricated_product_announcement`, `fabricated_funding_claim`,
       `celebrity_feud_document_authenticity`, `unverifiable_deleted_screenshot`,
       `news_headline_amplification` → `platform_manipulation`
     - opinion/framing/speculation/anecdote/clickbait/hyperbole catchalls that don't fit a
       territory category → DROP from `categories` and rely on `no_note_reason`/`role`
2. Keep `suggested_category` as-is (audit trail).
3. Backfill the 8 pilot annotations (oldest) to have all v2 schema fields where missing
   (`provisional_role`, `disagrees_with_provisional`, `no_note_reason`, `media_confidence`).

## Phase 7 — assembly (after Phase 6b)

Write `src/scripts_jim/2026_05_25_big_eval_dataset/08_assemble.py`:

1. **Join**: for each annotation file, load the corresponding `inputs/<id>.json` and the matching
   row in `selected.jsonl`. Build a unified record with: tweet content (text, author, media,
   comments), original note + status + tag counts, annotation fields, source/selection_bucket.
2. **Dedupe** by `tweet_id` (keep first; the ~6 colliding tweets lose 1 row each — accepted).
3. **Cap to ~50/50 `needs_note`**: count no/yes; if yes > no, drop excess `yes` rows preferring
   to keep showcase + helpful-diversity rows over the helpful-noisy-flipped-from-no-note rows.
   Target final size: max(2 × no-count, ~400). Keep dropped rows in a `pool.jsonl` for few-shot
   reuse later.
4. **Splits** (stratified by v2 category + needs_note):
   - `splits/test.jsonl` (100 rows)
   - `splits/val.jsonl` (100 rows)
   - `splits/pool.jsonl` (rest)
   Also write CSV versions compatible with `src/local/localPipelineRunner.ts` columns
   (`url, needs_note, ground_truth_note, tweet_text, tags`) plus extended judge columns
   (`judge_guidance, original_note_text, failure_reason`) consumed by the extended
   `judgeRow` in [src/local/evaluateResults.ts](../../src/local/evaluateResults.ts).
5. **`report.md`**: distributions by needs_note × category × no_note_reason; example rows; the
   ~30 most-recurring `suggested_category`s for future taxonomy iteration.

The judge wiring (`judgeRow`) was extended in Phase 8 to consume `judge_guidance`,
`original_note_text`, `failure_reason` — already in [evaluateResults.ts](../../src/local/evaluateResults.ts).
End-to-end smoke test: `bun run src/local/tryoutNotes.ts --bot simple-bot --max 5 datasets/big_eval/splits/val.csv`.

## Pitfalls

- **Don't trust the AI media description.** Corroborate against the note's sources + comments + web
  search; set `media_confidence: low` when uncertain. Several past failures came from trusting it.
- **Paywall-prone fact-check sources** (CNN, Snopes, NYT, Daily Mail) return 401/402/451 via
  WebFetch — route around via search snippets, Lead Stories, AFP/Reuters/AP, PolitiFact, Wikipedia.
- **`tweet_id` collisions**: 5 tweets have >1 selected note → annotation files overwrite each other
  (last-writer-wins). Acceptable (~6 rows lost); assembly's dedupe-by-tweet handles it.
- **Don't re-run `04_select.py` or `04b_boost_nonote.py`** without backing up `selected.jsonl` —
  04 regenerates from scratch (would lose booster); 04b appends (would duplicate).
- **`uv run` from repo root** (not from the script's dir) — paths in scripts use repo-root-relative
  resolution.

## What I'd do in your shoes (recommended fresh-session flow)

1. Read this file + [CATEGORIES.md](CATEGORIES.md) + the annotation spec. (5 min, small context.)
2. Start the watcher, run the prep + dispatch loop until PAUSE (~1 block = ~200 datapoints in a
   fresh session, vs ~70 in the bloated one).
3. After annotation completes (probably 1 more block after this), do Phase 6b normalization.
4. Then Phase 7 assembly + smoke test. Final dataset ready for hill-climbing.
