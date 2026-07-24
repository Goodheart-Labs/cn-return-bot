# Claim-coverage audit — does the filter see the whole speech? (2026-07-24)

Prompted by Nathan (Slack 7/24): *"can you check the address a bit and see what topics
it could be on … are the searches getting most of it?"*

## Provenance answer first

Yes, we started from the transcript. The Stage-2 brief
(`briefs/trump_election_security.md`) **is** the verbatim speech transcript, added in
PR #275 alongside the filter; every keyword-matched post is judged by the selection LLM
against the full transcript. So any claim *in the speech* is handled correctly **once a
post reaches Stage 2** — recall gaps live entirely in the Stage-1 regex
(`topics.ts`, widened once in #294).

## Method

1. `probe_filter.ts` — enumerated 11 claim areas (A–K) from the transcript, wrote 35
   realistic post paraphrases (incl. deliberately keyword-poor ones), ran them through
   the real predicate. Result: 18/35 hit; 4 misses were phrasings we'd expect to catch.
2. `scan_feed_recall.ts` — turned each probe miss into a marker regex and scanned the
   **unfiltered** eligible-feed snapshots (`feed_tweets`, 28,423 rows since 7/16) for
   posts carrying a marker but NOT matching the predicate. Counts in
   `recall_summary.json`; verbatim samples in `missed_samples.jsonl` (gitignored).

## What the filter covers well

The five core "areas of concern" as usually phrased: 220M/China voter files, deep-state
+ election-word coverup posts, machines/Dominion/Smartmatic/Maduro, 278,000
noncitizens (incl. "over 250 thousand", "quarter of a million"), dead voters, mail-in,
SAVE Act (standalone). Muskegon, "data exploitation unit", "largest compromise",
gift-card canvassers: every real post seen so far ALSO carried a matching keyword —
0 missed rows on those markers.

## Real gaps (missed rows in feed_tweets since 7/16, by missed impressions)

| gap family | missed | imps | note |
|---|---|---|---|
| China paid US journalists / pressured CEOs (2018–19 CIA reporting) | 9 | 4.1M | no election word in these posts at all |
| "shadow government" FBI email | 16 | 3.0M | ditto — biggest single miss 1.06M imps |
| NBC/ABC/CNN "refused to air the address" plot | 37 | 1.7M | mostly opinion/reporting; Stage 2 would skip many |
| coverup phrasings ("kept from the president", "cover story") near election context | 22 | 1.4M | predicate has no cover-up stem |
| ballots "through the mail" (not "mail-in") | 6 | 0.5M | |
| Obama "burn bags" | 11 | 0.3M | |
| California June2→July10 count / "third world country" | 1 | 81k | tiny volume |
| massaged Presidential Daily Brief | 2 | 32k | |

~106 marker rows / ~11.2M impressions total vs 1,408 predicate hits over the window.
Upper bound on missed **talk**, not missed misinfo — samples include neutral reporting
and mockery Stage 2 would reject. And markers only cover gap families enumerable from
the transcript; fully keyword-free paraphrase stays invisible to any regex (the LLM
pre-filter Nathan floated is the real fix for that tail).

## Second coverage axis: the grounding doc

`documents/trump_election_security.md` has per-claim debunks for areas 1–3, 5, mail-in,
and the stolen-2020 leap — but **nothing for Michigan/Muskegon (speech area 4), the
coverup specifics (burn bags / shadow government / massaged PDB), China's 2018–19
influence ops, or the California count-duration claim**. Stage 2 (transcript-based)
will happily select those posts; the writer then has no vetted in-group sources to cite.
Filter widening without doc sections just routes posts into weakly-grounded notes.

## Proposed follow-ups (not yet done)

1. Widen predicate: add `burn bags?`, `shadow government`, `presidential daily brief`
   to ELECTION_STANDALONE; add cover-up stem + `\bmail\b` + `compromis(e|ing)` +
   `to count the votes|third world country` to ELECTION_SIGNAL; pair ELECTION_CHINA
   with `journalists?|business leaders` as a second standalone-ish branch.
2. Add grounding-doc sections (with in-group sources) for Michigan/Muskegon, the
   coverup-specifics family, and China influence ops — or explicitly mark them
   "no vetted debunk yet → skip" in the doc's selection guidance.
3. Optional: costed LLM pre-filter experiment for the keyword-free tail.
