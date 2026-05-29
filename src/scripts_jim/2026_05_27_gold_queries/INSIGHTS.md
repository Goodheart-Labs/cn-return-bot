# Gold-query discovery — synthesis across 10 pilot rows

Anti-hindsight Sonnet subagents acted as fact-checkers (no reference URL visible). Each iterated WebSearch + WebFetch, found authoritative sources, and recorded process insights. The 10 rows cover 8 categories (misattributed media, conspiracy hoax, politics, ai-media, breaking news, statistical claim, manipulated evidence, celebrity, scams). All 10 reached `verdict: found_sources`.

## Headline finding

**The dominant lever is "decompose by claim," not exotic phrasing.** Round-1 queries from every agent look like ordinary v_final-style entity-driven queries. What separates wins from misses on hard rows is *writing multiple distinct queries — one for the EVENT and one for each FRAMING / IDENTITY / SUB-CLAIM*. 5 of 10 rows had a critical framing sub-claim that a single event-level query missed.

## Cross-row pattern matrix

| Row | Event-level query worked? | Framing/identity needs separate query? | What the falsifier looked like |
|---|---|---|---|
| Islamists attack (SF/SJ) | yes (with wrong-city tolerated) | YES — "Islamist" label false | Suspects are Assyrian/Armenian Christian |
| IShowSpeed proposal | yes (negative finding) | partial — needed positive "what he actually did" | Old-man-disguise stream confirmed |
| Indian crypto-miner | yes | YES — "Indian" label false | Suspect is Massachusetts/Lebanese-origin |
| F-15 pilot captured | yes | no | Media transcript had distinctive 1991 fingerprint |
| MSNBC chores graphic | yes | no | Primary-source query gives ground truth |
| Stiller/De Niro/Mamdani | yes (for De Niro) | YES — each sub-claim independently | Multi-claim tweet; each sub-claim needs check |
| Ellen citizenship | yes | no | Image itself carries "NOTHING is REAL" watermark |
| Netanyahu dead | yes | no | Direct death-rumor + proof-of-life queries |
| Kirk Dem area | yes | YES — "Dem area" + "Dem shooter" both false | Two distinct framing claims |
| Massie/TPUSA rally | yes | YES — "Trump haters" implies Dem; Massie is Republican | Org's own past praise of target is the falsifier |

**5/10 rows hinge on a separate framing/identity query, not the event query.**

## What helped (consistent across rows)

1. **Decomposition.** When a tweet bundles `[event happened] + [framing about who/where/why]`, the event query finds the event and the framing query finds the falsifier. They are different queries.
2. **Distinctive identifiers from media descriptions.** Defendant names in chyrons (Nadeam Nahas), unit numbers in audio (4th TFW, Al-Kharj), specific numbers in viral graphics (58% laundry) → unique-enough fingerprints to land authoritative sources in one shot.
3. **Primary-source-by-name query for statistical claims.** "Gallup household chores men women" hits the original survey directly, surfacing ground-truth numbers and inverted-labels error in parallel.
4. **Fact-check brand suffix is selective.** Helps on character/framing checks ("voter registration fact check") but adds noise on event-finding. Different from current v_final guidance which doesn't distinguish.
5. **Skeptical comments as signal.** Agents repeatedly leveraged top reply text ("AI slop", "this is from 1991") to direct queries. Production user message already includes top comments — this is being used.
6. **Searching "what actually happened" on the named date.** When a tweet alleges a current event, querying the event by date often surfaces fact-checks because the absence of mainstream coverage is itself the answer.

## What hurt

1. **Tweet's factual errors propagate.** "San Francisco" misled the agent's first query (real city was San Jose); a one-shot model less robust to noise would fail. Mitigation: include event keywords (`Jewish attacked cafe 2026`) even if the location is uncertain.
2. **Mainstream news paywalls** (NYT, CBS, ToI, Snopes paywall) blocked WebFetch verification in ~half of cases. Search snippets sufficed but verification was thinner than ideal. Not actionable for prompt design.
3. **No dedicated fact-check article for many claims.** Agents had to infer from "absence across mainstream sources." Search engines handle this reasonably; queries that mix "did X happen" with brand suffix still work.
4. **Ideological/character labels are not directly debunkable.** "Islamist" / "antifa" / "RINO" don't show up in mainstream coverage that would NEGATE them. Must query the suspect/identity DIRECTLY and infer negation.

## Multi-pass architecture: needed?

User asked whether 1 pass is enough or whether 2-round (explore → refine) is the right shape.

**Empirical answer: mostly capturable in single-pass via decomposition, with diminishing returns from a real second LLM call.**

- Of 5/10 rows that needed a separate framing query, none required the *output of the first query* to construct the second query. The decomposition is determinable from the tweet alone.
- A second LLM call adds latency × 2 and cost × 2 for marginal gain on the long tail.
- Recommendation: write 3-5 queries in one shot (event + each framing sub-claim) rather than 1-3.

**True two-pass would only help when** the tweet's distinctive entities are not yet known and emerge only from initial search snippets (e.g., a viral video where the date/location is uncertain and round 1 returns "this is actually from 1991"). 1/10 rows (F-15) was like this, but the media description already contained enough fingerprint signal to skip the extra round.

## Are Sonnet's Round-1 queries within DeepSeek's reach?

Yes. Round-1 queries are entity-driven and don't require domain expertise beyond what's in the user message. Examples:
- `"Charlie Kirk shot canvassing Utah 2026"` — direct from tweet entities
- `"MSNBC Gallup household chores men women percentages graphic error"` — entities from image
- `"Ellen DeGeneres renounced US citizenship moved to England"` — verbatim claim phrasing
- `"Netanyahu dead March 2026"` — claim + date

DeepSeek can do this. The gap is **quantity and distribution**: v_final permits 1-3 queries and doesn't push for claim-decomposition. Increasing to 3-5 with an explicit "one query per major claim" rule is the actionable change.

## What's NOT a prompt issue

Sonnet's WebSearch (Google-flavored) found sources easily for all 10 rows. The production gap to <10% URL on legacy backend is not a query problem — it's a **search-backend** problem. v_final on brave gets ~40-54% URL; the remaining headroom from prompt is small (estimated +3-8pp from decompose-by-claim).

## Proposed improvement: v24_decompose_by_claim

Single-pass prompt update. Changes from v_final:
1. Bump `1-3 queries` → `2-5 queries`.
2. Add a "Decompose first" section: list the distinct factual claims in the post (event + framing/identity/character/causal sub-claims) and write one query per claim.
3. Add explicit guidance: when the tweet uses an ideological / character / identity label ("Islamist", "antifa", "RINO", "Dem area", "Indian guy"), write a query directly checking THAT label, not just the underlying event.
4. Add: for viral statistics images, query the named primary source ("Gallup household chores 2019") in addition to the headline.

Validation plan: run v24 on val (n=59) with `SEARXNG_MODE=brave` and compare URL-exact% to v_final on same config. Multiple samples if needed to control for run-to-run variance.

## Out of scope but worth noting

- **OCR in media descriptions.** "NOTHING on this page is REAL" watermarks and chyron defendant names are jackpot signals. Worth verifying production media descriptions surface these. If not, the highest-leverage fix is in the media pipeline, not the query writer.
- **Backend.** v_final + brave already gets ~50% URL on val. Direct API backends bypass SearXNG IP rate-limiting and should be the production target regardless of prompt.

## Validation result (val, n=59, brave, retry-equipped harness)

| Variant | URL-exact | Domain | Judge | Avg queries |
|---|---|---|---|---|
| v_final          | 50.8% | 72.9% | 66.1% | 2.61 |
| **v24_decompose**| **62.7%** | **78.0%** | **67.8%** | **3.36** |
| Δ                | **+11.9pp** | +5.1pp | +1.7pp | +0.75 |

Clean head-to-head, 0 errored rows on both runs. Decomposition is active (queries per row went up by 0.75). The hypothesis from the 10-row batch-1 synthesis survived n=59 validation on the held-out val split.

## Batch 2 patterns (10 more rows) — does any new pattern justify a v25?

After running 10 more anti-hindsight subagents on the remaining pilot rows, the consistent finding is that **decompose-by-claim still captures the dominant lever**. Smaller patterns that emerged but were judged not worth a v25 iteration:

- **Fabricated screenshots of public figures** (Erika Kirk daughter post, Ellen DeGeneres, De Niro/Mamdani). Pattern: a screenshot of an alleged social-media post by a named figure → search "[named person] [exact quote from post] fake/debunked." Affects ~5-10% of rows. Expected lift: +2-3pp.
- **AI-fake media signal from comments + image artifacts** (ICE deli "PICF" instead of "ICE", AI-generated F-15E narration with wrong Mach 2.8). Pattern: when reply comments flag the post as AI/fake, or media description shows a known AI artifact (misspelled signage, extra fingers, watermark), add a query with "AI generated" / "fake." Affects ai_generated_media category (~12% of val). Expected lift: +3-5pp on that slice, smaller overall.
- **Methodology angle for real-data claims** (UK GDP per capita, Illinois reading-proficiency). Pattern: when a tweet cites real data + strong conclusion, query the specific institutions/methodology named (YCCS alternative-school context, ONS IHXW real-terms vs nominal). Affects ~5-10% of rows. Expected lift: +1-3pp.

Sum total of all three additions ≈ +3-6pp. **Not large enough to justify another brave validation cycle.** v24 is the recommended stopping point. The three patterns above are documented here for the next iteration if/when the team decides to push further.
