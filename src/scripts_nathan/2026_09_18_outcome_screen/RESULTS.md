# Outcome screen: which tweet-level features predict what happens to our note (2026-09-18)

Univariate screen, not a model. Hand-written summary; every number is copied from the generated tables below. Rerun with `uv run screen.py` (this section is preserved).

1. **Sample.** 2,168 notes since 2026-08-07; 2,026 matured (submitted before 2026-09-11 19:05 UTC); 227 H, 61 NH. One note per tweet.
2. **Base rates.** A (Aug 7-25): n=1,104, H 13.0% [11.1, 15.1], NH 3.3%, rated at all 16.2% [14.2, 18.5], H/(H+NH) 80%. B (Aug 26-Sep 11): n=922, H 9.1% [7.4, 11.1], NH 2.7%, rated 11.8% [9.9, 14.1], H/(H+NH) 77%. Week of Sep 4: H 7.1%.
3. **Holds in both periods (1): the tweet already has another note.** 1+ earlier notes vs 0: H +3.6pp (A), +4.8pp (B), pooled +4.3pp [+1.6, +7.0]. Rated-at-all does not move (-1.0pp [-4.3, +2.2]); the difference is NH. Post-hoc: NH 6.3% vs 1.6% (A), 6.8% vs 1.1% (B). No gradient beyond 0 vs 1+. AUC 0.54.
4. **Holds (2): tweet age at first sight.** H falls 2.7pp per band in both periods (A 15.4 / 13.7 / 10.0%, B 11.0 / 9.9 / 5.4% for <3h / 3-12h / 12-24h), pooled -2.7pp/band [-4.7, -0.6]. Most of it is the 12-24h band. AUC 0.55 (reversed).
5. **Holds (3): we noted this author before and never got an H.** Against no history: H -3.9pp (A), -5.0pp (B), pooled -4.5pp [-7.5, -1.6]; rated-at-all -4.6pp [-8.0, -1.2]. A past H on the author does not beat no history (flips: -3.0pp A, +2.3pp B).
6. **Holds (4; benchmark, not a tweet feature): evaluation score.** +2.5pp H per band [+1.1, +3.9]; the >=1 bucket is 25.0% (A, n=68) and 15.7% (B, n=70). AUC for H vs rest is 0.57 in both periods, not 0.67. H vs NH among rated notes only: 0.69 (A), 0.53 (B).
7. **Largest effect, but partly leaky.** An earlier note that is rated helpful *today*: H 36.2% vs 7.8% (A), 24.6% vs 4.9% (B). The competitor's status is today's, not its status when we submitted. A clean version needs status-at-submit from `public_data_snapshots` (not pulled).
8. **Same sign, but August carries it (faint in B).** Any media +6.3pp (A, p=0.01) then +2.9pp (B, p=0.23); author under 1M +8.1pp then +2.5pp (p=0.58); lower H for domains Events and Sports Team and entities Soccer, 2024 US Presidential Election, United States politics. Consistent with the 4-flag rule fading in September.
9. **Flips or noise.** Velocity (flat, AUC 0.51 / 0.53), feed tier, the 3-12h flag alone (+1.2pp [-1.6, +4.0]), follower trend, video vs photo, quote tweets, reply and quote ratio terciles, all seven keyword topics, the other domains and entities.
10. **Too few to tell.** Replies (n=10 and 16), non-English (n=3 in total), 4+ earlier notes (n=9 and 11), 24h+ age (n=0; the feed never surfaces them).
11. **Multiple comparisons.** 106 contrast-outcome pairs; about 5 would clear the pooled interval by chance. 18 did (2 are the leaky cut), but H rate and rated-at-all overlap heavily and several topic rows are the same tweets. Most non-leaky effects are 3-6pp with AUC at or under 0.57, the same ceiling as earlier work.
12. **Joins.** Run: 2,025 of 2,026 by `note_id` (the `tweet_id` fallback matched 0). Evaluation score missing for 89 (88 in B, almost all Sep 9-11). feed_tweets: 1,956 of 2,026 (96.5%); 57 of the 70 misses are in A; the missed notes have H 5.7%. competing_notes: 1,651 (81.5%) have any row, 1,366 (67.4%) have an earlier one.
13. **Deviations from the brief.** `author_handle` is NULL in every row, so author history is keyed on `author_id` (feed_tweets, then the `tweets` table). Author ids do not exist before Jan 2026, so older history is invisible. `author_followers` can be refreshed by later capture runs (slow-moving; treated as negligible). The "holds" verdict was split into two stricter tiers after the first run.
14. **Not screened.** Polarity / partisanship (needs an LLM or X's factor data), note text, A/B arms, any multivariate model or interaction.

<!-- AUTO-GENERATED BELOW THIS LINE BY screen.py; edits below are overwritten -->

## Sanity checks and joins

- Pull time (DB now): 2026-09-18 19:05 UTC. Maturity cutoff = pull time minus 7 days = 2026-09-11 19:05 UTC.
- `notes` rows pulled (whole table, narrow columns): 8808. Notes with coalesce(submitted_at, first_seen_at) >= 2026-08-07: 2168 (submitted_at null in 0). Of those, matured (older than 7 days): **2026**; excluded as too young: 142.
- One note per tweet in the matured set: True (distinct tweets 2026).
- cn_status in matured set: {'NEEDS_MORE_RATINGS': 1733, 'CURRENTLY_RATED_HELPFUL': 227, 'CURRENTLY_RATED_NOT_HELPFUL': 61, '(null)': 5}. Null and any other status count as unresolved.

| period | window (UTC) | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | 2026-08-07 to 2026-08-25 | 1104 | 143 | 36 | 13.0% [11.1%, 15.1%] | 3.3% | 16.2% [14.2%, 18.5%] | 80% |
| B | 2026-08-26 to 2026-09-11 19:05 | 922 | 84 | 25 | 9.1% [7.4%, 11.1%] | 2.7% | 11.8% [9.9%, 14.1%] | 77% |
| all | pooled | 2026 | 227 | 61 | 11.2% [9.9%, 12.7%] | 3.0% | 14.2% [12.8%, 15.8%] | 79% |

Weekly H rate (context for the time confound):

| week starting | n | H | NH | H rate | rated at all |
|---|---|---|---|---|---|
| 2026-08-07 | 455 | 61 | 16 | 13.4% | 16.9% |
| 2026-08-14 | 594 | 76 | 18 | 12.8% | 15.8% |
| 2026-08-21 | 176 | 15 | 4 | 8.5% | 10.8% |
| 2026-08-28 | 469 | 50 | 10 | 10.7% | 12.8% |
| 2026-09-04 | 309 | 22 | 12 | 7.1% | 11.0% |
| 2026-09-11 | 23 | 3 | 1 | 13.0% | 17.4% |

- Join to submitting run: by `pipeline_runs.note_id` = 2025; by fallback `tweet_id` + outcome='submitted' = 0; failed = 1 of 2026 (100.0% joined).
- Evaluation score present: 1937 of 2026 (95.6%). Missing by period: A 1, B 88. Submit dates of the missing-score notes are listed under table 10.
- Join to `feed_tweets`: 1956 of 2026 (96.5%). Missing by period: A 57, B 13. H rate of the notes that failed this join: 5.7% (n=70).
- At least one `competing_notes` row (any time, joined on tweet_id): 1651 of 2026 (81.5%). At least one created before our note: 1366 (67.4%). A tweet with no row is treated as having 0 other notes; the table is filled from the full public dump for every tweet where our note appears in the dump.
- Author id available (feed_tweets, then `tweets`): 2026 of 2026. `author_handle` is NULL in every pulled row of both tables, so author history is keyed on `author_id`. Across all 8808 notes we ever wrote, author id is known for 7753; the gap is almost all Oct-Dec 2025 notes, which therefore cannot count as history.
- raw_tweet is written once at first sight (checked in code: `insertNewFeedTweets` never rewrites it) and `public_metrics.impression_count` equals `first_seen_impressions` in 100.0% of joined rows.

## How the verdicts are assigned

Fixed before reading the outcome tables. Each feature has one or two pre-declared contrasts (a two-group risk difference, or a linear slope across ordered bands). Each contrast is computed separately in period A and period B for two outcomes: H rate and rated-at-all rate.

- **too few to tell**: a compared group has n < 30 in either period (for band trends: fewer than two bands with n >= 30).
- **flips**: the sign of the effect differs between A and B.
- **holds (both periods)**: same sign in both periods, the period-stratified pooled 95% interval (inverse-variance over A and B) excludes zero, and each period on its own has p < 0.10.
- **holds in sign (A or B carries it)**: same sign and the pooled interval excludes zero, but one period on its own has p >= 0.10, so the pooled result leans on the other period. This tier was split out from 'holds' after the first run because the single 'holds' label was too generous to effects that were strong in August and faint in September. The split only makes verdicts stricter.
- **same sign, within noise**: same sign in both periods but the pooled interval includes zero. Two periods agree in sign by chance half the time, so this is not evidence.
- Buckets with n < 30 are marked †. Two-group intervals are Newcombe; band slopes are linear-probability slopes in percentage points per band.


## 1. Already has Community Notes (other notes created before ours)

Count of `competing_notes` rows on the tweet with `created_at_millis` before our submit time. All classifications counted, including NOT_MISLEADING notes. Knowable at submit time in principle.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1104 | 143 | 36 | 13.0% [11.1%, 15.1%] | 3.3% | 16.2% [14.2%, 18.5%] | 80% (143/179) |
| A | 0 | 395 | 42 | 25 | 10.6% [8.0%, 14.1%] | 6.3% | 17.0% [13.6%, 21.0%] | 63% (42/67) |
| A | 1 | 466 | 66 | 7 | 14.2% [11.3%, 17.6%] | 1.5% | 15.7% [12.6%, 19.2%] | 90% (66/73) |
| A | 2-3 | 234 | 35 | 4 | 15.0% [11.0%, 20.1%] | 1.7% | 16.7% [12.4%, 22.0%] | 90% (35/39) |
| A | 4+ † | 9 | 0 | 0 | 0.0% [0.0%, 29.9%] | 0.0% | 0.0% [0.0%, 29.9%] | n/a (0/0) |
| B | **all with this feature (base)** | 922 | 84 | 25 | 9.1% [7.4%, 11.1%] | 2.7% | 11.8% [9.9%, 14.1%] | 77% (84/109) |
| B | 0 | 265 | 15 | 18 | 5.7% [3.5%, 9.1%] | 6.8% | 12.5% [9.0%, 17.0%] | 45% (15/33) |
| B | 1 | 387 | 44 | 7 | 11.4% [8.6%, 14.9%] | 1.8% | 13.2% [10.2%, 16.9%] | 86% (44/51) |
| B | 2-3 | 259 | 24 | 0 | 9.3% [6.3%, 13.4%] | 0.0% | 9.3% [6.3%, 13.4%] | 100% (24/24) |
| B | 4+ † | 11 | 1 | 0 | 9.1% [1.6%, 37.7%] | 0.0% | 9.1% [1.6%, 37.7%] | 100% (1/1) |

- 1+ earlier notes vs 0, H rate: A: +3.6pp [-0.6pp, +7.5pp], Fisher p=0.093 (n=709 vs 395); B: +4.8pp [+0.8pp, +8.2pp], Fisher p=0.022 (n=657 vs 265); period-stratified pooled +4.3pp [+1.6pp, +7.0pp] → **holds (both periods)**
- 1+ earlier notes vs 0, rated at all: A: -1.2pp [-5.9pp, +3.3pp], Fisher p=0.610 (n=709 vs 395); B: -0.9pp [-5.9pp, +3.5pp], Fisher p=0.736 (n=657 vs 265); period-stratified pooled -1.0pp [-4.3pp, +2.2pp] → **same sign, within noise**
- trend across 0 / 1 / 2-3 / 4+, H rate: A: +1.78pp/band [-0.81pp, +4.37pp], p=0.177 (n=1104); B: +1.68pp/band [-0.69pp, +4.05pp], p=0.164 (n=922); period-stratified pooled +1.73pp/band [-0.02pp, +3.47pp] → **same sign, within noise**
- trend across 0 / 1 / 2-3 / 4+, rated at all: A: -0.74pp/band [-3.59pp, +2.10pp], p=0.608 (n=1104); B: -1.57pp/band [-4.22pp, +1.09pp], p=0.248 (n=922); period-stratified pooled -1.18pp/band [-3.12pp, +0.76pp] → **same sign, within noise**

## 1b. Earlier note currently rated helpful (PARTLY LEAKY: competitor status is measured today)

Indicative only. The competitor's `current_status` is today's value, so it includes ratings that arrived after we submitted. A tweet where another note ended up helpful is also a tweet where ours is less likely to be shown.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1104 | 143 | 36 | 13.0% [11.1%, 15.1%] | 3.3% | 16.2% [14.2%, 18.5%] | 80% (143/179) |
| A | no earlier note | 395 | 42 | 25 | 10.6% [8.0%, 14.1%] | 6.3% | 17.0% [13.6%, 21.0%] | 63% (42/67) |
| A | earlier note, none rated H today | 549 | 43 | 11 | 7.8% [5.9%, 10.4%] | 2.0% | 9.8% [7.6%, 12.6%] | 80% (43/54) |
| A | earlier note, >=1 rated H today | 160 | 58 | 0 | 36.2% [29.2%, 43.9%] | 0.0% | 36.2% [29.2%, 43.9%] | 100% (58/58) |
| B | **all with this feature (base)** | 922 | 84 | 25 | 9.1% [7.4%, 11.1%] | 2.7% | 11.8% [9.9%, 14.1%] | 77% (84/109) |
| B | no earlier note | 265 | 15 | 18 | 5.7% [3.5%, 9.1%] | 6.8% | 12.5% [9.0%, 17.0%] | 45% (15/33) |
| B | earlier note, none rated H today | 470 | 23 | 7 | 4.9% [3.3%, 7.2%] | 1.5% | 6.4% [4.5%, 9.0%] | 77% (23/30) |
| B | earlier note, >=1 rated H today | 187 | 46 | 0 | 24.6% [19.0%, 31.2%] | 0.0% | 24.6% [19.0%, 31.2%] | 100% (46/46) |

- earlier note rated H today vs earlier notes none H, H rate: A: +28.4pp [+20.9pp, +36.4pp], Fisher p=0.000 (n=160 vs 549); B: +19.7pp [+13.6pp, +26.5pp], Fisher p=0.000 (n=187 vs 470); period-stratified pooled +23.3pp [+18.3pp, +28.3pp] → **holds (both periods)**
- earlier note rated H today vs earlier notes none H, rated at all: A: +26.4pp [+18.8pp, +34.4pp], Fisher p=0.000 (n=160 vs 549); B: +18.2pp [+12.0pp, +25.1pp], Fisher p=0.000 (n=187 vs 470); period-stratified pooled +21.6pp [+16.6pp, +26.6pp] → **holds (both periods)**

## 2. Our own history with the author (out of time)

Our earlier notes on the same `author_id` submitted more than 7 days before this note. Their labels are today's `cn_status`, which is final by day 7 in 99.5% of cases, so the leak is small. History before Jan 2026 is invisible (no author id), which pushes some authors into 'no history'.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1104 | 143 | 36 | 13.0% [11.1%, 15.1%] | 3.3% | 16.2% [14.2%, 18.5%] | 80% (143/179) |
| A | no history | 668 | 96 | 23 | 14.4% [11.9%, 17.2%] | 3.4% | 17.8% [15.1%, 20.9%] | 81% (96/119) |
| A | history, none H | 286 | 30 | 8 | 10.5% [7.4%, 14.6%] | 2.8% | 13.3% [9.8%, 17.7%] | 79% (30/38) |
| A | history, >=1 H | 150 | 17 | 5 | 11.3% [7.2%, 17.4%] | 3.3% | 14.7% [9.9%, 21.2%] | 77% (17/22) |
| A | (author id missing) † | 0 | 0 | 0 | n/a [n/a, n/a] | n/a | n/a [n/a, n/a] | n/a (0/0) |
| B | **all with this feature (base)** | 922 | 84 | 25 | 9.1% [7.4%, 11.1%] | 2.7% | 11.8% [9.9%, 14.1%] | 77% (84/109) |
| B | no history | 577 | 57 | 18 | 9.9% [7.7%, 12.6%] | 3.1% | 13.0% [10.5%, 16.0%] | 76% (57/75) |
| B | history, none H | 205 | 10 | 7 | 4.9% [2.7%, 8.7%] | 3.4% | 8.3% [5.2%, 12.9%] | 59% (10/17) |
| B | history, >=1 H | 140 | 17 | 0 | 12.1% [7.7%, 18.6%] | 0.0% | 12.1% [7.7%, 18.6%] | 100% (17/17) |
| B | (author id missing) † | 0 | 0 | 0 | n/a [n/a, n/a] | n/a | n/a [n/a, n/a] | n/a (0/0) |

- history with >=1 H vs no history, H rate: A: -3.0pp [-8.1pp, +3.5pp], Fisher p=0.362 (n=150 vs 668); B: +2.3pp [-2.9pp, +9.1pp], Fisher p=0.440 (n=140 vs 577); period-stratified pooled -0.5pp [-4.6pp, +3.7pp] → **flips**
- history with >=1 H vs no history, rated at all: A: -3.1pp [-8.8pp, +3.9pp], Fisher p=0.403 (n=150 vs 668); B: -0.9pp [-6.2pp, +6.1pp], Fisher p=0.888 (n=140 vs 577); period-stratified pooled -2.0pp [-6.4pp, +2.5pp] → **same sign, within noise**
- history with >=1 H vs history none H, H rate: A: +0.8pp [-5.0pp, +7.6pp], Fisher p=0.871 (n=150 vs 286); B: +7.3pp [+1.4pp, +14.1pp], Fisher p=0.023 (n=140 vs 205); period-stratified pooled +4.1pp [-0.4pp, +8.5pp] → **same sign, within noise**
- history with >=1 H vs history none H, rated at all: A: +1.4pp [-5.1pp, +8.8pp], Fisher p=0.770 (n=150 vs 286); B: +3.9pp [-2.5pp, +11.0pp], Fisher p=0.272 (n=140 vs 205); period-stratified pooled +2.7pp [-2.2pp, +7.5pp] → **same sign, within noise**
- history none H vs no history, H rate: A: -3.9pp [-8.1pp, +0.9pp], Fisher p=0.118 (n=286 vs 668); B: -5.0pp [-8.5pp, -0.6pp], Fisher p=0.029 (n=205 vs 577); period-stratified pooled -4.5pp [-7.5pp, -1.6pp] → **holds in sign (B carries it)**
- history none H vs no history, rated at all: A: -4.5pp [-9.2pp, +0.7pp], Fisher p=0.087 (n=286 vs 668); B: -4.7pp [-9.0pp, +0.5pp], Fisher p=0.078 (n=205 vs 577); period-stratified pooled -4.6pp [-8.0pp, -1.2pp] → **holds (both periods)**

## 3a. Topic: X context_annotations domains (non-exclusive)

A tweet can carry several domains, so rows overlap and do not sum to the base. Top 12 domains by n across both periods, plus 'none' (no annotations: 602 of 1956). Contrast for each row is 'has this domain' vs 'all other joined notes'.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | Unified Twitter Taxonomy | 635 | 83 | 17 | 13.1% [10.7%, 15.9%] | 2.7% | 15.7% [13.1%, 18.8%] | 83% (83/100) |
| A | Business Taxonomy | 462 | 60 | 12 | 13.0% [10.2%, 16.4%] | 2.6% | 15.6% [12.6%, 19.2%] | 83% (60/72) |
| A | Person | 383 | 48 | 9 | 12.5% [9.6%, 16.2%] | 2.3% | 14.9% [11.7%, 18.8%] | 84% (48/57) |
| A | Events [Entity Service] | 150 | 10 | 6 | 6.7% [3.7%, 11.8%] | 4.0% | 10.7% [6.7%, 16.6%] | 62% (10/16) |
| A | Brand | 140 | 25 | 7 | 17.9% [12.4%, 25.0%] | 5.0% | 22.9% [16.7%, 30.5%] | 78% (25/32) |
| A | Entities [Entity Service] | 125 | 16 | 7 | 12.8% [8.0%, 19.8%] | 5.6% | 18.4% [12.6%, 26.1%] | 70% (16/23) |
| A | Politician | 109 | 16 | 2 | 14.7% [9.2%, 22.5%] | 1.8% | 16.5% [10.7%, 24.6%] | 89% (16/18) |
| A | Athlete | 97 | 7 | 2 | 7.2% [3.5%, 14.2%] | 2.1% | 9.3% [5.0%, 16.7%] | 78% (7/9) |
| A | Sport | 82 | 6 | 2 | 7.3% [3.4%, 15.1%] | 2.4% | 9.8% [5.0%, 18.1%] | 75% (6/8) |
| A | Interests and Hobbies Category | 76 | 13 | 2 | 17.1% [10.3%, 27.1%] | 2.6% | 19.7% [12.3%, 30.0%] | 87% (13/15) |
| A | Brand Vertical | 89 | 15 | 4 | 16.9% [10.5%, 26.0%] | 4.5% | 21.3% [14.1%, 31.0%] | 79% (15/19) |
| A | Sports Team | 78 | 4 | 2 | 5.1% [2.0%, 12.5%] | 2.6% | 7.7% [3.6%, 15.8%] | 67% (4/6) |
| A | none | 303 | 40 | 12 | 13.2% [9.8%, 17.5%] | 4.0% | 17.2% [13.3%, 21.8%] | 77% (40/52) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | Unified Twitter Taxonomy | 511 | 44 | 15 | 8.6% [6.5%, 11.4%] | 2.9% | 11.5% [9.1%, 14.6%] | 75% (44/59) |
| B | Business Taxonomy | 342 | 34 | 9 | 9.9% [7.2%, 13.6%] | 2.6% | 12.6% [9.5%, 16.5%] | 79% (34/43) |
| B | Person | 288 | 26 | 10 | 9.0% [6.2%, 12.9%] | 3.5% | 12.5% [9.2%, 16.8%] | 72% (26/36) |
| B | Events [Entity Service] | 139 | 10 | 5 | 7.2% [4.0%, 12.7%] | 3.6% | 10.8% [6.6%, 17.0%] | 67% (10/15) |
| B | Brand | 109 | 7 | 5 | 6.4% [3.1%, 12.7%] | 4.6% | 11.0% [6.4%, 18.3%] | 58% (7/12) |
| B | Entities [Entity Service] | 105 | 7 | 4 | 6.7% [3.3%, 13.1%] | 3.8% | 10.5% [6.0%, 17.8%] | 64% (7/11) |
| B | Politician | 105 | 8 | 4 | 7.6% [3.9%, 14.3%] | 3.8% | 11.4% [6.7%, 18.9%] | 67% (8/12) |
| B | Athlete | 55 | 6 | 1 | 10.9% [5.1%, 21.8%] | 1.8% | 12.7% [6.3%, 24.0%] | 86% (6/7) |
| B | Sport | 64 | 8 | 2 | 12.5% [6.5%, 22.8%] | 3.1% | 15.6% [8.7%, 26.4%] | 80% (8/10) |
| B | Interests and Hobbies Category | 68 | 7 | 0 | 10.3% [5.1%, 19.8%] | 0.0% | 10.3% [5.1%, 19.8%] | 100% (7/7) |
| B | Brand Vertical | 55 | 5 | 4 | 9.1% [3.9%, 19.6%] | 7.3% | 16.4% [8.9%, 28.3%] | 56% (5/9) |
| B | Sports Team | 54 | 4 | 3 | 7.4% [2.9%, 17.6%] | 5.6% | 13.0% [6.4%, 24.4%] | 57% (4/7) |
| B | none | 299 | 28 | 6 | 9.4% [6.6%, 13.2%] | 2.0% | 11.4% [8.3%, 15.5%] | 82% (28/34) |

Contrasts for these rows are in the verdict roll-up at the end.

## 3b. Topic: most common context_annotations entities (non-exclusive)

Top 12 entity names by n. Same layout as 3a.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | Politics | 160 | 18 | 3 | 11.2% [7.2%, 17.1%] | 1.9% | 13.1% [8.7%, 19.2%] | 86% (18/21) |
| A | Sports & Fitness Business | 150 | 13 | 4 | 8.7% [5.1%, 14.3%] | 2.7% | 11.3% [7.2%, 17.4%] | 76% (13/17) |
| A | Sports | 141 | 11 | 4 | 7.8% [4.4%, 13.4%] | 2.8% | 10.6% [6.6%, 16.8%] | 73% (11/15) |
| A | Entertainment & Leisure Business | 127 | 18 | 1 | 14.2% [9.2%, 21.3%] | 0.8% | 15.0% [9.8%, 22.2%] | 95% (18/19) |
| A | United States politics | 103 | 9 | 2 | 8.7% [4.7%, 15.8%] | 1.9% | 10.7% [6.1%, 18.1%] | 82% (9/11) |
| A | Political figures | 99 | 13 | 1 | 13.1% [7.8%, 21.2%] | 1.0% | 14.1% [8.6%, 22.3%] | 93% (13/14) |
| A | Gaming Business | 119 | 16 | 3 | 13.4% [8.4%, 20.7%] | 2.5% | 16.0% [10.5%, 23.6%] | 84% (16/19) |
| A | 2024 US Presidential Election | 101 | 7 | 3 | 6.9% [3.4%, 13.6%] | 3.0% | 9.9% [5.5%, 17.3%] | 70% (7/10) |
| A | Entertainment | 121 | 19 | 2 | 15.7% [10.3%, 23.2%] | 1.7% | 17.4% [11.6%, 25.1%] | 90% (19/21) |
| A | Soccer | 87 | 3 | 2 | 3.4% [1.2%, 9.7%] | 2.3% | 5.7% [2.5%, 12.8%] | 60% (3/5) |
| A | Donald Trump | 52 | 4 | 1 | 7.7% [3.0%, 18.2%] | 1.9% | 9.6% [4.2%, 20.6%] | 80% (4/5) |
| A | 2024 US Election | 47 | 4 | 1 | 8.5% [3.4%, 19.9%] | 2.1% | 10.6% [4.6%, 22.6%] | 80% (4/5) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | Politics | 158 | 12 | 7 | 7.6% [4.4%, 12.8%] | 4.4% | 12.0% [7.8%, 18.0%] | 63% (12/19) |
| B | Sports & Fitness Business | 104 | 12 | 3 | 11.5% [6.7%, 19.1%] | 2.9% | 14.4% [8.9%, 22.4%] | 80% (12/15) |
| B | Sports | 100 | 10 | 3 | 10.0% [5.5%, 17.4%] | 3.0% | 13.0% [7.8%, 21.0%] | 77% (10/13) |
| B | Entertainment & Leisure Business | 95 | 8 | 1 | 8.4% [4.3%, 15.7%] | 1.1% | 9.5% [5.1%, 17.0%] | 89% (8/9) |
| B | United States politics | 99 | 6 | 5 | 6.1% [2.8%, 12.6%] | 5.1% | 11.1% [6.3%, 18.8%] | 55% (6/11) |
| B | Political figures | 102 | 7 | 3 | 6.9% [3.4%, 13.5%] | 2.9% | 9.8% [5.4%, 17.1%] | 70% (7/10) |
| B | Gaming Business | 78 | 3 | 4 | 3.8% [1.3%, 10.7%] | 5.1% | 9.0% [4.4%, 17.4%] | 43% (3/7) |
| B | 2024 US Presidential Election | 85 | 6 | 4 | 7.1% [3.3%, 14.6%] | 4.7% | 11.8% [6.5%, 20.3%] | 60% (6/10) |
| B | Entertainment | 57 | 6 | 4 | 10.5% [4.9%, 21.1%] | 7.0% | 17.5% [9.8%, 29.4%] | 60% (6/10) |
| B | Soccer | 55 | 3 | 1 | 5.5% [1.9%, 14.9%] | 1.8% | 7.3% [2.9%, 17.3%] | 75% (3/4) |
| B | Donald Trump | 51 | 4 | 0 | 7.8% [3.1%, 18.5%] | 0.0% | 7.8% [3.1%, 18.5%] | 100% (4/4) |
| B | 2024 US Election | 50 | 4 | 0 | 8.0% [3.2%, 18.8%] | 0.0% | 8.0% [3.2%, 18.8%] | 100% (4/4) |

Contrasts for these rows are in the verdict roll-up at the end.

## 3c. Topic: crude keyword match on tweet text (non-exclusive)

Word-boundary match on the tweet text. Lists are below so they can be judged; they are rough, overlap, and miss image-only or non-English posts.

- **politics/election** — case-insensitive: trump, biden, harris, obama, president, presidential, congress, senate, senator, democrat, democrats, republican, republicans, gop, maga, election, elections, vote, votes, voter, voters, voting, ballot, ballots, governor, white house, supreme court, parliament, prime minister, minister, labour, tory, tories, starmer, farage, liberals, conservatives, immigration, immigrant, immigrants, migrants, border, deport, deported, deportation, deportations, tariff, tariffs, campaign, administration, legislation, bill, mayor, politician, politicians, leftist, leftists, left-wing, right-wing, far-right, far-left; case-sensitive: ICE, DOJ, FBI, DOGE, AOC
- **war/conflict** — case-insensitive: war, wars, ukraine, ukrainian, russia, russian, putin, zelensky, zelenskyy, israel, israeli, gaza, hamas, hezbollah, iran, iranian, palestine, palestinian, palestinians, idf, military, missile, missiles, airstrike, airstrikes, troops, army, nato, invasion, ceasefire, bomb, bombs, bombing, bombed, soldier, soldiers, genocide, taiwan, houthi, houthis, syria, drone strike, hostage, hostages, terrorist, terrorists, terrorism
- **health/science** — case-insensitive: vaccine, vaccines, vaccinated, vaccination, covid, virus, cancer, doctor, doctors, hospital, hospitals, health, healthcare, medical, medicine, drug, drugs, autism, disease, diseases, study, studies, scientist, scientists, science, scientific, research, researchers, climate, nasa, measles, tylenol, ozempic, diet, obesity, mental health, fluoride, pandemic; case-sensitive: FDA, CDC, RFK, WHO, NIH
- **celebrity/entertainment** — case-insensitive: movie, movies, film, films, actor, actress, singer, rapper, album, song, songs, netflix, disney, hollywood, celebrity, celebrities, kardashian, taylor swift, beyonce, drake, kanye, grammy, grammys, oscar, oscars, emmy, emmys, tv show, trailer, concert, tour, anime, marvel, star wars, video game, gaming, gta, box office, streamer, youtuber, influencer, kpop, k-pop, bts, fans
- **sports** — case-insensitive: nfl, nba, mlb, nhl, ufc, fifa, wwe, world cup, premier league, champions league, football, soccer, basketball, baseball, tennis, golf, olympic, olympics, quarterback, touchdown, playoffs, championship, coach, player, players, league, season, messi, ronaldo, lebron, goal, goals, match, striker, transfer, boxing, fight, knockout; case-sensitive: F1
- **crypto/finance** — case-insensitive: bitcoin, btc, ethereum, crypto, cryptocurrency, token, tokens, memecoin, solana, stock, stocks, stock market, nasdaq, s&p, dow jones, interest rate, interest rates, inflation, economy, recession, bank, banks, investor, investors, investment, shares, earnings, ipo, billion, trillion, gdp, debt, jobs report, unemployment; case-sensitive: ETH, SEC, Fed
- **AI/tech** — case-insensitive: a.i., artificial intelligence, chatgpt, openai, gpt, grok, claude, gemini, llm, robot, robots, robotaxi, tesla, spacex, starlink, elon, musk, iphone, google, microsoft, nvidia, software, startup, algorithm, deepfake, ai-generated, ai generated, data center, data centers, chip, chips, semiconductor; case-sensitive: AI, AGI, Apple, Meta

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | politics/election | 164 | 21 | 5 | 12.8% [8.5%, 18.8%] | 3.0% | 15.9% [11.1%, 22.2%] | 81% (21/26) |
| A | war/conflict | 90 | 8 | 6 | 8.9% [4.6%, 16.6%] | 6.7% | 15.6% [9.5%, 24.4%] | 57% (8/14) |
| A | health/science | 79 | 13 | 3 | 16.5% [9.9%, 26.1%] | 3.8% | 20.3% [12.9%, 30.4%] | 81% (13/16) |
| A | celebrity/entertainment | 153 | 26 | 1 | 17.0% [11.9%, 23.7%] | 0.7% | 17.6% [12.4%, 24.5%] | 96% (26/27) |
| A | sports | 97 | 13 | 3 | 13.4% [8.0%, 21.6%] | 3.1% | 16.5% [10.4%, 25.1%] | 81% (13/16) |
| A | crypto/finance | 51 | 10 | 3 | 19.6% [11.0%, 32.5%] | 5.9% | 25.5% [15.5%, 38.9%] | 77% (10/13) |
| A | AI/tech | 43 | 6 | 1 | 14.0% [6.6%, 27.3%] | 2.3% | 16.3% [8.1%, 30.0%] | 86% (6/7) |
| A | no keyword matched | 506 | 60 | 21 | 11.9% [9.3%, 15.0%] | 4.2% | 16.0% [13.1%, 19.5%] | 74% (60/81) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | politics/election | 138 | 12 | 2 | 8.7% [5.0%, 14.6%] | 1.4% | 10.1% [6.1%, 16.3%] | 86% (12/14) |
| B | war/conflict | 108 | 11 | 3 | 10.2% [5.8%, 17.3%] | 2.8% | 13.0% [7.9%, 20.6%] | 79% (11/14) |
| B | health/science | 54 | 4 | 0 | 7.4% [2.9%, 17.6%] | 0.0% | 7.4% [2.9%, 17.6%] | 100% (4/4) |
| B | celebrity/entertainment | 80 | 5 | 1 | 6.2% [2.7%, 13.8%] | 1.2% | 7.5% [3.5%, 15.4%] | 83% (5/6) |
| B | sports | 71 | 7 | 3 | 9.9% [4.9%, 19.0%] | 4.2% | 14.1% [7.8%, 24.0%] | 70% (7/10) |
| B | crypto/finance | 36 | 0 | 1 | 0.0% [0.0%, 9.6%] | 2.8% | 2.8% [0.5%, 14.2%] | 0% (0/1) |
| B | AI/tech | 52 | 4 | 3 | 7.7% [3.0%, 18.2%] | 5.8% | 13.5% [6.7%, 25.3%] | 57% (4/7) |
| B | no keyword matched | 463 | 47 | 14 | 10.2% [7.7%, 13.2%] | 3.0% | 13.2% [10.4%, 16.6%] | 77% (47/61) |

Contrasts for these rows are in the verdict roll-up at the end.

## 4a. Velocity at first sight

first_seen_impressions / max(hours from posted_at to first_seen_at, 0.25).

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | <5k/h | 57 | 10 | 1 | 17.5% [9.8%, 29.4%] | 1.8% | 19.3% [11.1%, 31.3%] | 91% (10/11) |
| A | 5-15k/h | 167 | 24 | 5 | 14.4% [9.9%, 20.5%] | 3.0% | 17.4% [12.4%, 23.8%] | 83% (24/29) |
| A | 15-50k/h | 492 | 57 | 13 | 11.6% [9.1%, 14.7%] | 2.6% | 14.2% [11.4%, 17.6%] | 81% (57/70) |
| A | 50k+/h | 331 | 48 | 17 | 14.5% [11.1%, 18.7%] | 5.1% | 19.6% [15.7%, 24.3%] | 74% (48/65) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | <5k/h | 73 | 9 | 0 | 12.3% [6.6%, 21.8%] | 0.0% | 12.3% [6.6%, 21.8%] | 100% (9/9) |
| B | 5-15k/h | 217 | 16 | 5 | 7.4% [4.6%, 11.6%] | 2.3% | 9.7% [6.4%, 14.3%] | 76% (16/21) |
| B | 15-50k/h | 350 | 32 | 12 | 9.1% [6.6%, 12.6%] | 3.4% | 12.6% [9.5%, 16.5%] | 73% (32/44) |
| B | 50k+/h | 269 | 27 | 8 | 10.0% [7.0%, 14.2%] | 3.0% | 13.0% [9.5%, 17.6%] | 77% (27/35) |

- trend across velocity bands, H rate: A: -0.36pp/band [-2.84pp, +2.11pp], p=0.773 (n=1047); B: +0.22pp/band [-1.83pp, +2.27pp], p=0.834 (n=909); period-stratified pooled -0.02pp/band [-1.60pp, +1.56pp] → **flips**
- trend across velocity bands, rated at all: A: +0.78pp/band [-1.94pp, +3.50pp], p=0.574 (n=1047); B: +0.95pp/band [-1.35pp, +3.25pp], p=0.420 (n=909); period-stratified pooled +0.88pp/band [-0.88pp, +2.63pp] → **same sign, within noise**

## 4b. Feed tier at first sight (`first_seen_feed_size`)

Feed size is an A/B arm whose mix changed over time, so it is confounded with date inside each period.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | small | 95 | 12 | 4 | 12.6% [7.4%, 20.8%] | 4.2% | 16.8% [10.6%, 25.6%] | 75% (12/16) |
| A | large | 392 | 56 | 21 | 14.3% [11.2%, 18.1%] | 5.4% | 19.6% [16.0%, 23.9%] | 73% (56/77) |
| A | xl | 560 | 71 | 11 | 12.7% [10.2%, 15.7%] | 2.0% | 14.6% [12.0%, 17.8%] | 87% (71/82) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | small | 156 | 11 | 3 | 7.1% [4.0%, 12.2%] | 1.9% | 9.0% [5.4%, 14.5%] | 79% (11/14) |
| B | large | 552 | 57 | 13 | 10.3% [8.1%, 13.1%] | 2.4% | 12.7% [10.2%, 15.7%] | 81% (57/70) |
| B | xl | 201 | 16 | 9 | 8.0% [5.0%, 12.5%] | 4.5% | 12.4% [8.6%, 17.7%] | 64% (16/25) |

- trend across small / large / xl, H rate: A: -0.61pp/band [-3.75pp, +2.53pp], p=0.704 (n=1047); B: +0.24pp/band [-2.78pp, +3.25pp], p=0.878 (n=909); period-stratified pooled -0.17pp/band [-2.35pp, +2.01pp] → **flips**
- trend across small / large / xl, rated at all: A: -2.61pp/band [-6.07pp, +0.84pp], p=0.138 (n=1047); B: +1.58pp/band [-1.80pp, +4.96pp], p=0.360 (n=909); period-stratified pooled -0.47pp/band [-2.89pp, +1.94pp] → **flips**

## 5. Tweet age at first sight

Hours from posted_at to first_seen_at. Maximum observed is 23.6h, so the 24h+ band is empty by construction of the feed.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | <3h | 246 | 38 | 8 | 15.4% [11.5%, 20.5%] | 3.3% | 18.7% [14.3%, 24.0%] | 83% (38/46) |
| A | 3-12h | 562 | 77 | 16 | 13.7% [11.1%, 16.8%] | 2.8% | 16.5% [13.7%, 19.8%] | 83% (77/93) |
| A | 12-24h | 239 | 24 | 12 | 10.0% [6.8%, 14.5%] | 5.0% | 15.1% [11.1%, 20.1%] | 67% (24/36) |
| A | 24h+ † | 0 | 0 | 0 | n/a [n/a, n/a] | n/a | n/a [n/a, n/a] | n/a (0/0) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | <3h | 228 | 25 | 6 | 11.0% [7.5%, 15.7%] | 2.6% | 13.6% [9.7%, 18.7%] | 81% (25/31) |
| B | 3-12h | 496 | 49 | 13 | 9.9% [7.6%, 12.8%] | 2.6% | 12.5% [9.9%, 15.7%] | 79% (49/62) |
| B | 12-24h | 185 | 10 | 6 | 5.4% [3.0%, 9.7%] | 3.2% | 8.6% [5.4%, 13.6%] | 62% (10/16) |
| B | 24h+ † | 0 | 0 | 0 | n/a [n/a, n/a] | n/a | n/a [n/a, n/a] | n/a (0/0) |

- trend across <3h / 3-12h / 12-24h, H rate: A: -2.70pp/band [-5.71pp, +0.32pp], p=0.080 (n=1047); B: -2.68pp/band [-5.48pp, +0.11pp], p=0.060 (n=909); period-stratified pooled -2.69pp/band [-4.74pp, -0.64pp] → **holds (both periods)**
- trend across <3h / 3-12h / 12-24h, rated at all: A: -1.82pp/band [-5.14pp, +1.50pp], p=0.283 (n=1047); B: -2.40pp/band [-5.54pp, +0.75pp], p=0.135 (n=909); period-stratified pooled -2.12pp/band [-4.41pp, +0.16pp] → **same sign, within noise**
- 3-12h vs other ages (the old 'fresh' flag), H rate: A: +0.9pp [-3.3pp, +5.0pp], Fisher p=0.715 (n=562 vs 485); B: +1.4pp [-2.5pp, +5.2pp], Fisher p=0.492 (n=496 vs 413); period-stratified pooled +1.2pp [-1.6pp, +4.0pp] → **same sign, within noise**
- 3-12h vs other ages (the old 'fresh' flag), rated at all: A: -0.4pp [-4.9pp, +4.1pp], Fisher p=0.934 (n=562 vs 485); B: +1.1pp [-3.2pp, +5.3pp], Fisher p=0.682 (n=496 vs 413); period-stratified pooled +0.4pp [-2.7pp, +3.5pp] → **flips**

## 6. Author size

`author_followers` from feed_tweets. Note: this column can be refreshed if a later capture run re-sees the tweet; follower counts move slowly, so the leak is judged negligible, but it is not a strict first-sight value.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | <10k | 371 | 52 | 11 | 14.0% [10.9%, 17.9%] | 3.0% | 17.0% [13.5%, 21.1%] | 83% (52/63) |
| A | 10k-100k | 317 | 40 | 5 | 12.6% [9.4%, 16.7%] | 1.6% | 14.2% [10.8%, 18.5%] | 89% (40/45) |
| A | 100k-1M | 243 | 40 | 14 | 16.5% [12.3%, 21.6%] | 5.8% | 22.2% [17.5%, 27.9%] | 74% (40/54) |
| A | 1M+ | 116 | 7 | 6 | 6.0% [3.0%, 11.9%] | 5.2% | 11.2% [6.7%, 18.2%] | 54% (7/13) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | <10k | 310 | 26 | 7 | 8.4% [5.8%, 12.0%] | 2.3% | 10.6% [7.7%, 14.6%] | 79% (26/33) |
| B | 10k-100k | 276 | 35 | 7 | 12.7% [9.3%, 17.1%] | 2.5% | 15.2% [11.5%, 19.9%] | 83% (35/42) |
| B | 100k-1M | 223 | 16 | 10 | 7.2% [4.5%, 11.3%] | 4.5% | 11.7% [8.1%, 16.5%] | 62% (16/26) |
| B | 1M+ | 100 | 7 | 1 | 7.0% [3.4%, 13.7%] | 1.0% | 8.0% [4.1%, 15.0%] | 88% (7/8) |

- trend across follower bands, H rate: A: -1.11pp/band [-3.14pp, +0.93pp], p=0.287 (n=1047); B: -0.70pp/band [-2.58pp, +1.17pp], p=0.464 (n=909); period-stratified pooled -0.89pp/band [-2.27pp, +0.49pp] → **same sign, within noise**
- trend across follower bands, rated at all: A: -0.04pp/band [-2.28pp, +2.20pp], p=0.975 (n=1047); B: -0.50pp/band [-2.60pp, +1.61pp], p=0.644 (n=909); period-stratified pooled -0.28pp/band [-1.81pp, +1.25pp] → **same sign, within noise**
- under 1M vs 1M+ (the old 'small author' flag), H rate: A: +8.1pp [+1.9pp, +12.0pp], Fisher p=0.013 (n=931 vs 116); B: +2.5pp [-4.5pp, +6.7pp], Fisher p=0.582 (n=809 vs 100); period-stratified pooled +5.6pp [+1.9pp, +9.4pp] → **holds in sign (A carries it)**
- under 1M vs 1M+ (the old 'small author' flag), rated at all: A: +6.2pp [-1.2pp, +11.4pp], Fisher p=0.112 (n=931 vs 116); B: +4.5pp [-2.8pp, +9.1pp], Fisher p=0.252 (n=809 vs 100); period-stratified pooled +5.3pp [+1.0pp, +9.6pp] → **holds in sign (A carries it)**

## 7a. Media

video = has_video (including the rows that have both video and photo); photo = has_photo only.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | video | 447 | 63 | 12 | 14.1% [11.2%, 17.6%] | 2.7% | 16.8% [13.6%, 20.5%] | 84% (63/75) |
| A | photo | 352 | 55 | 7 | 15.6% [12.2%, 19.8%] | 2.0% | 17.6% [14.0%, 21.9%] | 89% (55/62) |
| A | none | 248 | 21 | 17 | 8.5% [5.6%, 12.6%] | 6.9% | 15.3% [11.4%, 20.3%] | 55% (21/38) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | video | 385 | 41 | 9 | 10.6% [7.9%, 14.1%] | 2.3% | 13.0% [10.0%, 16.7%] | 82% (41/50) |
| B | photo | 298 | 27 | 6 | 9.1% [6.3%, 12.9%] | 2.0% | 11.1% [8.0%, 15.1%] | 82% (27/33) |
| B | none | 226 | 16 | 10 | 7.1% [4.4%, 11.2%] | 4.4% | 11.5% [8.0%, 16.3%] | 62% (16/26) |

- any media vs none, H rate: A: +6.3pp [+1.6pp, +10.2pp], Fisher p=0.010 (n=799 vs 248); B: +2.9pp [-1.7pp, +6.5pp], Fisher p=0.233 (n=683 vs 226); period-stratified pooled +4.5pp [+1.5pp, +7.5pp] → **holds in sign (A carries it)**
- any media vs none, rated at all: A: +1.8pp [-3.8pp, +6.6pp], Fisher p=0.559 (n=799 vs 248); B: +0.6pp [-4.7pp, +5.1pp], Fisher p=0.906 (n=683 vs 226); period-stratified pooled +1.2pp [-2.4pp, +4.7pp] → **same sign, within noise**
- video vs photo, H rate: A: -1.5pp [-6.6pp, +3.4pp], Fisher p=0.549 (n=447 vs 352); B: +1.6pp [-3.1pp, +6.0pp], Fisher p=0.522 (n=385 vs 298); period-stratified pooled +0.2pp [-3.2pp, +3.5pp] → **flips**
- video vs photo, rated at all: A: -0.8pp [-6.2pp, +4.4pp], Fisher p=0.777 (n=447 vs 352); B: +1.9pp [-3.1pp, +6.7pp], Fisher p=0.480 (n=385 vs 298); period-stratified pooled +0.6pp [-3.0pp, +4.2pp] → **flips**

## 7b. Is reply / is quote (from referenced_tweets)

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | reply † | 10 | 5 | 0 | 50.0% [23.7%, 76.3%] | 0.0% | 50.0% [23.7%, 76.3%] | 100% (5/5) |
| A | not reply | 1037 | 134 | 36 | 12.9% [11.0%, 15.1%] | 3.5% | 16.4% [14.3%, 18.8%] | 79% (134/170) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | reply † | 16 | 1 | 0 | 6.2% [1.1%, 28.3%] | 0.0% | 6.2% [1.1%, 28.3%] | 100% (1/1) |
| B | not reply | 893 | 83 | 25 | 9.3% [7.6%, 11.4%] | 2.8% | 12.1% [10.1%, 14.4%] | 77% (83/108) |

- reply vs not, H rate: A: +37.1pp [+10.6pp, +63.5pp], Fisher p=0.006 (n=10 vs 1037); B: -3.0pp [-8.6pp, +19.1pp], Fisher p=1.000 (n=16 vs 893); period-stratified pooled +5.4pp [-7.6pp, +18.4pp] → **too few to tell**
- reply vs not, rated at all: A: +33.6pp [+7.2pp, +60.0pp], Fisher p=0.015 (n=10 vs 1037); B: -5.8pp [-11.5pp, +16.3pp], Fisher p=0.709 (n=16 vs 893); period-stratified pooled +2.5pp [-10.6pp, +15.5pp] → **too few to tell**

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | quote | 175 | 16 | 13 | 9.1% [5.7%, 14.3%] | 7.4% | 16.6% [11.8%, 22.8%] | 55% (16/29) |
| A | not quote | 872 | 123 | 23 | 14.1% [12.0%, 16.6%] | 2.6% | 16.7% [14.4%, 19.4%] | 84% (123/146) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | quote | 171 | 14 | 6 | 8.2% [4.9%, 13.3%] | 3.5% | 11.7% [7.7%, 17.4%] | 70% (14/20) |
| B | not quote | 738 | 70 | 19 | 9.5% [7.6%, 11.8%] | 2.6% | 12.1% [9.9%, 14.6%] | 79% (70/89) |

- quote vs not, H rate: A: -5.0pp [-9.2pp, +0.7pp], Fisher p=0.087 (n=175 vs 872); B: -1.3pp [-5.3pp, +4.1pp], Fisher p=0.663 (n=171 vs 738); period-stratified pooled -3.0pp [-6.4pp, +0.4pp] → **same sign, within noise**
- quote vs not, rated at all: A: -0.2pp [-5.6pp, +6.5pp], Fisher p=1.000 (n=175 vs 872); B: -0.4pp [-5.1pp, +5.7pp], Fisher p=1.000 (n=171 vs 738); period-stratified pooled -0.3pp [-4.3pp, +3.8pp] → **same sign, within noise**

## 8. First-sight engagement ratios (contested-post proxy)

From raw_tweet.public_metrics at first sight. Terciles are cut once on all joined matured notes (no labels used): reply_count/impressions cuts at 0.00027 and 0.00099; quote_count/impressions cuts at 0.000064 and 0.000271.

reply_count / impression_count:

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | low | 379 | 45 | 14 | 11.9% [9.0%, 15.5%] | 3.7% | 15.6% [12.3%, 19.6%] | 76% (45/59) |
| A | mid | 368 | 50 | 13 | 13.6% [10.5%, 17.5%] | 3.5% | 17.1% [13.6%, 21.3%] | 79% (50/63) |
| A | high | 300 | 44 | 9 | 14.7% [11.1%, 19.1%] | 3.0% | 17.7% [13.8%, 22.4%] | 83% (44/53) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | low | 273 | 24 | 9 | 8.8% [6.0%, 12.7%] | 3.3% | 12.1% [8.7%, 16.5%] | 73% (24/33) |
| B | mid | 284 | 30 | 10 | 10.6% [7.5%, 14.7%] | 3.5% | 14.1% [10.5%, 18.6%] | 75% (30/40) |
| B | high | 352 | 30 | 6 | 8.5% [6.0%, 11.9%] | 1.7% | 10.2% [7.5%, 13.8%] | 83% (30/36) |

- trend across reply-ratio terciles, H rate: A: +1.41pp/band [-1.15pp, +3.97pp], p=0.282 (n=1047); B: -0.21pp/band [-2.50pp, +2.08pp], p=0.857 (n=909); period-stratified pooled +0.51pp/band [-1.20pp, +2.21pp] → **flips**
- trend across reply-ratio terciles, rated at all: A: +1.07pp/band [-1.75pp, +3.89pp], p=0.457 (n=1047); B: -1.05pp/band [-3.61pp, +1.52pp], p=0.423 (n=909); period-stratified pooled -0.09pp/band [-1.99pp, +1.81pp] → **flips**

quote_count / impression_count:

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | low | 380 | 53 | 12 | 13.9% [10.8%, 17.8%] | 3.2% | 17.1% [13.7%, 21.2%] | 82% (53/65) |
| A | mid | 374 | 43 | 13 | 11.5% [8.6%, 15.1%] | 3.5% | 15.0% [11.7%, 18.9%] | 77% (43/56) |
| A | high | 293 | 43 | 11 | 14.7% [11.1%, 19.2%] | 3.8% | 18.4% [14.4%, 23.3%] | 80% (43/54) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | low | 272 | 21 | 5 | 7.7% [5.1%, 11.5%] | 1.8% | 9.6% [6.6%, 13.6%] | 81% (21/26) |
| B | mid | 278 | 26 | 11 | 9.4% [6.5%, 13.4%] | 4.0% | 13.3% [9.8%, 17.8%] | 70% (26/37) |
| B | high | 359 | 37 | 9 | 10.3% [7.6%, 13.9%] | 2.5% | 12.8% [9.7%, 16.7%] | 80% (37/46) |

- trend across quote-ratio terciles, H rate: A: +0.23pp/band [-2.35pp, +2.81pp], p=0.860 (n=1047); B: +1.28pp/band [-1.00pp, +3.55pp], p=0.271 (n=909); period-stratified pooled +0.82pp/band [-0.89pp, +2.53pp] → **same sign, within noise**
- trend across quote-ratio terciles, rated at all: A: +0.53pp/band [-2.30pp, +3.37pp], p=0.713 (n=1047); B: +1.54pp/band [-1.02pp, +4.09pp], p=0.238 (n=909); period-stratified pooled +1.09pp/band [-0.81pp, +2.98pp] → **same sign, within noise**

## 9. Language

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1047 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | en | 1045 | 139 | 36 | 13.3% [11.4%, 15.5%] | 3.4% | 16.7% [14.6%, 19.1%] | 79% (139/175) |
| A | other † | 2 | 0 | 0 | 0.0% [0.0%, 65.8%] | 0.0% | 0.0% [0.0%, 65.8%] | n/a (0/0) |
| B | **all with this feature (base)** | 909 | 84 | 25 | 9.2% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | en | 908 | 84 | 25 | 9.3% [7.5%, 11.3%] | 2.8% | 12.0% [10.0%, 14.3%] | 77% (84/109) |
| B | other † | 1 | 0 | 0 | 0.0% [0.0%, 79.3%] | 0.0% | 0.0% [0.0%, 79.3%] | n/a (0/0) |

- en vs other, H rate: A: +13.3pp [-52.5pp, +15.5pp], Fisher p=1.000 (n=1045 vs 2); B: +9.3pp [-70.1pp, +11.3pp], Fisher p=1.000 (n=908 vs 1); period-stratified pooled +11.7pp [-21.5pp, +45.0pp] → **too few to tell**
- en vs other, rated at all: A: +16.7pp [-49.1pp, +19.1pp], Fisher p=1.000 (n=1045 vs 2); B: +12.0pp [-67.4pp, +14.3pp], Fisher p=1.000 (n=908 vs 1); period-stratified pooled +14.9pp [-18.3pp, +48.2pp] → **too few to tell**

## 10. Evaluation score (X evaluate_note; post-write, not a tweet-level feature; benchmark only)

Missing is its own bucket. The missing bucket is almost entirely the last days before the maturity cutoff, so it is confounded with date. Every matured note ran under `eval_submit_threshold` = -3, so the low end is barely truncated.

| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |
|---|---|---|---|---|---|---|---|---|
| A | **all with this feature (base)** | 1104 | 143 | 36 | 13.0% [11.1%, 15.1%] | 3.3% | 16.2% [14.2%, 18.5%] | 80% (143/179) |
| A | <0 | 450 | 49 | 23 | 10.9% [8.3%, 14.1%] | 5.1% | 16.0% [12.9%, 19.7%] | 68% (49/72) |
| A | 0-0.5 | 224 | 25 | 6 | 11.2% [7.7%, 16.0%] | 2.7% | 13.8% [9.9%, 19.0%] | 81% (25/31) |
| A | 0.5-1 | 361 | 52 | 6 | 14.4% [11.2%, 18.4%] | 1.7% | 16.1% [12.6%, 20.2%] | 90% (52/58) |
| A | >=1 | 68 | 17 | 1 | 25.0% [16.2%, 36.4%] | 1.5% | 26.5% [17.4%, 38.0%] | 94% (17/18) |
| A | missing † | 1 | 0 | 0 | 0.0% [0.0%, 79.3%] | 0.0% | 0.0% [0.0%, 79.3%] | n/a (0/0) |
| B | **all with this feature (base)** | 922 | 84 | 25 | 9.1% [7.4%, 11.1%] | 2.7% | 11.8% [9.9%, 14.1%] | 77% (84/109) |
| B | <0 | 324 | 20 | 8 | 6.2% [4.0%, 9.3%] | 2.5% | 8.6% [6.0%, 12.2%] | 71% (20/28) |
| B | 0-0.5 | 159 | 20 | 7 | 12.6% [8.3%, 18.6%] | 4.4% | 17.0% [11.9%, 23.6%] | 74% (20/27) |
| B | 0.5-1 | 281 | 26 | 6 | 9.3% [6.4%, 13.2%] | 2.1% | 11.4% [8.2%, 15.6%] | 81% (26/32) |
| B | >=1 | 70 | 11 | 2 | 15.7% [9.0%, 26.0%] | 2.9% | 18.6% [11.2%, 29.2%] | 85% (11/13) |
| B | missing | 88 | 7 | 2 | 8.0% [3.9%, 15.5%] | 2.3% | 10.2% [5.5%, 18.3%] | 78% (7/9) |

- trend across the four scored bands, H rate: A: +2.86pp/band [+0.86pp, +4.86pp], p=0.005 (n=1103); B: +2.18pp/band [+0.26pp, +4.10pp], p=0.026 (n=834); period-stratified pooled +2.51pp/band [+1.12pp, +3.89pp] → **holds (both periods)**
- trend across the four scored bands, rated at all: A: +1.33pp/band [-0.87pp, +3.53pp], p=0.236 (n=1103); B: +2.10pp/band [-0.05pp, +4.25pp], p=0.056 (n=834); period-stratified pooled +1.72pp/band [+0.19pp, +3.26pp] → **holds in sign (B carries it)**

Missing-score notes by submit date: {datetime.date(2026, 8, 20): 1, datetime.date(2026, 9, 3): 1, datetime.date(2026, 9, 5): 1, datetime.date(2026, 9, 6): 1, datetime.date(2026, 9, 9): 16, datetime.date(2026, 9, 10): 46, datetime.date(2026, 9, 11): 23}

## Univariate AUC per period (comparator to earlier work)

AUC for H vs everything else, using the raw continuous value of features already listed above. Sign is kept: below 0.5 means higher values go with fewer H. Intervals are Hanley-McNeil 95%. Earlier work: fetch-time predictors 0.55-0.60 temporal AUC, evaluation score about 0.67.

| feature (raw value) | A: AUC [95%] (n, H) | B: AUC [95%] (n, H) |
|---|---|---|
| earlier notes count | 0.538 [0.487, 0.590] (n=1104, H=143) | 0.539 [0.473, 0.605] (n=922, H=84) |
| age at first sight (h) | 0.448 [0.398, 0.498] (n=1047, H=139) | 0.443 [0.381, 0.505] (n=909, H=84) |
| velocity (impr/h) | 0.508 [0.456, 0.560] (n=1047, H=139) | 0.529 [0.463, 0.595] (n=909, H=84) |
| author followers | 0.475 [0.425, 0.526] (n=1047, H=139) | 0.463 [0.400, 0.526] (n=909, H=84) |
| reply/impression | 0.540 [0.487, 0.592] (n=1047, H=139) | 0.485 [0.421, 0.549] (n=909, H=84) |
| quote/impression | 0.510 [0.459, 0.562] (n=1047, H=139) | 0.520 [0.454, 0.585] (n=909, H=84) |
| evaluation score (non-missing) | 0.566 [0.514, 0.618] (n=1103, H=143) | 0.570 [0.500, 0.639] (n=834, H=77) |
| evaluation score, H vs NH among rated notes only | 0.686 [0.597, 0.775] (H=143, NH=36) | 0.532 [0.399, 0.665] (H=77, NH=23) |

The last row is a different question (given a note got rated, which way) and is shown because it is the only framing here that reproduces the earlier ~0.67, and only in period A.

## POST-HOC (chosen after looking at the tables; hypothesis-generating only)

The NH column stood out in three tables, so NH rate was tested for those three contrasts only. These were picked because they looked large, which inflates them. There are 61 NH notes in total.

- NH rate, 0 earlier notes vs 1+, period A: 25/395 (6.3%) vs 11/709 (1.6%); difference +4.8pp [+2.4pp, +7.7pp], Fisher p=0.0001
- NH rate, 0 earlier notes vs 1+, period B: 18/265 (6.8%) vs 7/657 (1.1%); difference +5.7pp [+3.0pp, +9.5pp], Fisher p=0.0000
- NH rate, no media vs any media, period A: 17/248 (6.9%) vs 19/799 (2.4%); difference +4.5pp [+1.6pp, +8.4pp], Fisher p=0.0020
- NH rate, no media vs any media, period B: 10/226 (4.4%) vs 15/683 (2.2%); difference +2.2pp [-0.2pp, +5.9pp], Fisher p=0.0978
- NH rate, quote tweet vs not, period A: 13/175 (7.4%) vs 23/872 (2.6%); difference +4.8pp [+1.5pp, +9.7pp], Fisher p=0.0046
- NH rate, quote tweet vs not, period B: 6/171 (3.5%) vs 19/738 (2.6%); difference +0.9pp [-1.4pp, +5.0pp], Fisher p=0.4460

## Verdict roll-up (all pre-declared contrasts)

106 contrast-outcome pairs were screened (53 contrasts x 2 outcomes). With this many, a few 'holds' are expected by chance even if nothing is real; treat a 'holds' as a candidate, not a finding.

| feature | contrast | outcome | A effect | B effect | pooled [95%] | verdict |
|---|---|---|---|---|---|---|
| 1 prior notes | 1+ earlier notes vs 0 | H rate | +3.61pp (p=0.093) | +4.84pp (p=0.022) | +4.28pp [+1.56pp, +6.99pp] | holds (both periods) |
| 1 prior notes | 1+ earlier notes vs 0 | rated at all | -1.17pp (p=0.610) | -0.89pp (p=0.736) | -1.03pp [-4.30pp, +2.25pp] | same sign, within noise |
| 1 prior notes | trend across 0 / 1 / 2-3 / 4+ | H rate | +1.78pp/band (p=0.177) | +1.68pp/band (p=0.164) | +1.73pp [-0.02pp, +3.47pp] | same sign, within noise |
| 1 prior notes | trend across 0 / 1 / 2-3 / 4+ | rated at all | -0.74pp/band (p=0.608) | -1.57pp/band (p=0.248) | -1.18pp [-3.12pp, +0.76pp] | same sign, within noise |
| 1b earlier note H today (leaky) | earlier note rated H today vs earlier notes none H | H rate | +28.42pp (p=0.000) | +19.71pp (p=0.000) | +23.29pp [+18.32pp, +28.25pp] | holds (both periods) |
| 1b earlier note H today (leaky) | earlier note rated H today vs earlier notes none H | rated at all | +26.41pp (p=0.000) | +18.22pp (p=0.000) | +21.60pp [+16.57pp, +26.62pp] | holds (both periods) |
| 2 author history | history with >=1 H vs no history | H rate | -3.04pp (p=0.362) | +2.26pp (p=0.440) | -0.48pp [-4.64pp, +3.68pp] | flips |
| 2 author history | history with >=1 H vs no history | rated at all | -3.15pp (p=0.403) | -0.86pp (p=0.888) | -1.95pp [-6.38pp, +2.47pp] | same sign, within noise |
| 2 author history | history with >=1 H vs history none H | H rate | +0.84pp (p=0.871) | +7.26pp (p=0.023) | +4.05pp [-0.38pp, +8.48pp] | same sign, within noise |
| 2 author history | history with >=1 H vs history none H | rated at all | +1.38pp (p=0.770) | +3.85pp (p=0.272) | +2.66pp [-2.15pp, +7.47pp] | same sign, within noise |
| 2 author history | history none H vs no history | H rate | -3.88pp (p=0.118) | -5.00pp (p=0.029) | -4.51pp [-7.46pp, -1.57pp] | holds in sign (B carries it) |
| 2 author history | history none H vs no history | rated at all | -4.53pp (p=0.087) | -4.71pp (p=0.078) | -4.62pp [-8.02pp, -1.22pp] | holds (both periods) |
| 3a domain | domain 'Unified Twitter Taxonomy' vs rest | H rate | -0.52pp (p=0.852) | -1.44pp (p=0.489) | -1.02pp [-3.87pp, +1.82pp] | same sign, within noise |
| 3a domain | domain 'Unified Twitter Taxonomy' vs rest | rated at all | -2.46pp (p=0.310) | -1.02pp (p=0.681) | -1.67pp [-4.84pp, +1.49pp] | same sign, within noise |
| 3a domain | domain 'Business Taxonomy' vs rest | H rate | -0.52pp (p=0.855) | +1.12pp (p=0.636) | +0.34pp [-2.53pp, +3.20pp] | flips |
| 3a domain | domain 'Business Taxonomy' vs rest | rated at all | -2.02pp (p=0.405) | +0.93pp (p=0.675) | -0.51pp [-3.67pp, +2.65pp] | flips |
| 3a domain | domain 'Person' vs rest | H rate | -1.17pp (p=0.637) | -0.31pp (p=1.000) | -0.72pp [-3.65pp, +2.21pp] | same sign, within noise |
| 3a domain | domain 'Person' vs rest | rated at all | -2.89pp (p=0.264) | +0.74pp (p=0.743) | -1.07pp [-4.33pp, +2.19pp] | flips |
| 3a domain | domain 'Events [Entity Service]' vs rest | H rate | -7.71pp (p=0.009) | -2.42pp (p=0.429) | -5.16pp [-8.56pp, -1.77pp] | holds in sign (A carries it) |
| 3a domain | domain 'Events [Entity Service]' vs rest | rated at all | -7.06pp (p=0.033) | -1.42pp (p=0.777) | -4.30pp [-8.30pp, -0.30pp] | holds in sign (A carries it) |
| 3a domain | domain 'Brand' vs rest | H rate | +5.29pp (p=0.107) | -3.20pp (p=0.377) | +0.00pp [-4.13pp, +4.13pp] | flips |
| 3a domain | domain 'Brand' vs rest | rated at all | +7.09pp (p=0.051) | -1.12pp (p=0.875) | +2.43pp [-2.40pp, +7.25pp] | flips |
| 3a domain | domain 'Entities [Entity Service]' vs rest | H rate | -0.54pp (p=1.000) | -2.91pp (p=0.472) | -1.91pp [-6.01pp, +2.19pp] | same sign, within noise |
| 3a domain | domain 'Entities [Entity Service]' vs rest | rated at all | +1.91pp (p=0.609) | -1.71pp (p=0.749) | -0.12pp [-4.90pp, +4.67pp] | flips |
| 3a domain | domain 'Politician' vs rest | H rate | +1.57pp (p=0.655) | -1.83pp (p=0.719) | -0.51pp [-4.91pp, +3.89pp] | flips |
| 3a domain | domain 'Politician' vs rest | rated at all | -0.22pp (p=1.000) | -0.64pp (p=1.000) | -0.45pp [-5.38pp, +4.47pp] | same sign, within noise |
| 3a domain | domain 'Athlete' vs rest | H rate | -6.68pp (p=0.082) | +1.78pp (p=0.630) | -4.09pp [-8.93pp, +0.74pp] | flips |
| 3a domain | domain 'Athlete' vs rest | rated at all | -8.20pp (p=0.044) | +0.78pp (p=0.831) | -5.29pp [-10.57pp, -0.02pp] | flips |
| 3a domain | domain 'Sport' vs rest | H rate | -6.47pp (p=0.125) | +3.51pp (p=0.367) | -2.93pp [-7.99pp, +2.13pp] | flips |
| 3a domain | domain 'Sport' vs rest | rated at all | -7.55pp (p=0.090) | +3.91pp (p=0.323) | -3.35pp [-8.95pp, +2.25pp] | flips |
| 3a domain | domain 'Interests and Hobbies Category' vs rest | H rate | +4.13pp (p=0.294) | +1.14pp (p=0.667) | +2.44pp [-3.35pp, +8.23pp] | same sign, within noise |
| 3a domain | domain 'Interests and Hobbies Category' vs rest | rated at all | +3.26pp (p=0.429) | -1.83pp (p=0.846) | +0.27pp [-5.68pp, +6.23pp] | flips |
| 3a domain | domain 'Brand Vertical' vs rest | H rate | +3.91pp (p=0.326) | -0.16pp (p=1.000) | +1.90pp [-3.87pp, +7.66pp] | flips |
| 3a domain | domain 'Brand Vertical' vs rest | rated at all | +5.06pp (p=0.234) | +4.65pp (p=0.287) | +4.89pp [-1.76pp, +11.53pp] | same sign, within noise |
| 3a domain | domain 'Sports Team' vs rest | H rate | -8.80pp (p=0.024) | -1.95pp (p=0.810) | -6.37pp [-10.97pp, -1.76pp] | holds in sign (A carries it) |
| 3a domain | domain 'Sports Team' vs rest | rated at all | -9.75pp (p=0.026) | +1.03pp (p=0.828) | -6.17pp [-11.60pp, -0.75pp] | flips |
| 3a domain | domain 'none' vs rest | H rate | -0.11pp (p=1.000) | +0.18pp (p=0.904) | +0.06pp [-2.97pp, +3.08pp] | flips |
| 3a domain | domain 'none' vs rest | rated at all | +0.63pp (p=0.855) | -0.92pp (p=0.745) | -0.24pp [-3.58pp, +3.10pp] | flips |
| 3b entity | entity 'Politics' vs rest | H rate | -2.39pp (p=0.450) | -1.99pp (p=0.545) | -2.16pp [-5.74pp, +1.41pp] | same sign, within noise |
| 3b entity | entity 'Politics' vs rest | rated at all | -4.24pp (p=0.206) | +0.04pp (p=1.000) | -2.02pp [-6.07pp, +2.03pp] | flips |
| 3b entity | entity 'Sports & Fitness Business' vs rest | H rate | -5.38pp (p=0.090) | +2.59pp (p=0.371) | -2.35pp [-6.39pp, +1.69pp] | flips |
| 3b entity | entity 'Sports & Fitness Business' vs rest | rated at all | -6.28pp (p=0.059) | +2.75pp (p=0.423) | -2.78pp [-7.24pp, +1.69pp] | flips |
| 3b entity | entity 'Sports' vs rest | H rate | -6.33pp (p=0.044) | +0.85pp (p=0.717) | -3.52pp [-7.48pp, +0.44pp] | flips |
| 3b entity | entity 'Sports' vs rest | rated at all | -7.02pp (p=0.039) | +1.13pp (p=0.744) | -3.77pp [-8.22pp, +0.67pp] | flips |
| 3b entity | entity 'Entertainment & Leisure Business' vs rest | H rate | +1.02pp (p=0.780) | -0.92pp (p=1.000) | -0.01pp [-4.46pp, +4.45pp] | flips |
| 3b entity | entity 'Entertainment & Leisure Business' vs rest | rated at all | -2.00pp (p=0.703) | -2.81pp (p=0.506) | -2.42pp [-7.07pp, +2.23pp] | same sign, within noise |
| 3b entity | entity 'United States politics' vs rest | H rate | -5.03pp (p=0.171) | -3.57pp (p=0.356) | -4.21pp [-8.22pp, -0.21pp] | holds in sign (A carries it) |
| 3b entity | entity 'United States politics' vs rest | rated at all | -6.69pp (p=0.095) | -0.99pp (p=0.871) | -3.91pp [-8.59pp, +0.78pp] | same sign, within noise |
| 3b entity | entity 'Political figures' vs rest | H rate | -0.16pp (p=1.000) | -2.68pp (p=0.470) | -1.73pp [-6.08pp, +2.62pp] | same sign, within noise |
| 3b entity | entity 'Political figures' vs rest | rated at all | -2.84pp (p=0.571) | -2.46pp (p=0.627) | -2.63pp [-7.42pp, +2.17pp] | same sign, within noise |
| 3b entity | entity 'Gaming Business' vs rest | H rate | +0.19pp (p=1.000) | -5.90pp (p=0.101) | -3.56pp [-7.63pp, +0.51pp] | flips |
| 3b entity | entity 'Gaming Business' vs rest | rated at all | -0.84pp (p=0.897) | -3.30pp (p=0.469) | -2.09pp [-7.03pp, +2.86pp] | same sign, within noise |
| 3b entity | entity '2024 US Presidential Election' vs rest | H rate | -7.02pp (p=0.046) | -2.41pp (p=0.559) | -4.89pp [-9.01pp, -0.77pp] | holds in sign (A carries it) |
| 3b entity | entity '2024 US Presidential Election' vs rest | rated at all | -7.54pp (p=0.067) | -0.25pp (p=1.000) | -4.37pp [-9.20pp, +0.47pp] | same sign, within noise |
| 3b entity | entity 'Entertainment' vs rest | H rate | +2.74pp (p=0.394) | +1.37pp (p=0.641) | +2.20pp [-3.14pp, +7.54pp] | same sign, within noise |
| 3b entity | entity 'Entertainment' vs rest | rated at all | +0.72pp (p=0.797) | +5.92pp (p=0.203) | +2.46pp [-3.41pp, +8.32pp] | same sign, within noise |
| 3b entity | entity 'Soccer' vs rest | H rate | -10.72pp (p=0.003) | -4.03pp (p=0.470) | -8.52pp [-12.49pp, -4.56pp] | holds in sign (A carries it) |
| 3b entity | entity 'Soccer' vs rest | rated at all | -11.96pp (p=0.002) | -5.02pp (p=0.390) | -9.47pp [-14.06pp, -4.87pp] | holds in sign (A carries it) |
| 3b entity | entity 'Donald Trump' vs rest | H rate | -5.88pp (p=0.295) | -1.48pp (p=1.000) | -3.70pp [-9.40pp, +2.00pp] | same sign, within noise |
| 3b entity | entity 'Donald Trump' vs rest | rated at all | -7.47pp (p=0.185) | -4.39pp (p=0.504) | -5.84pp [-11.79pp, +0.12pp] | same sign, within noise |
| 3b entity | entity '2024 US Election' vs rest | H rate | -4.99pp (p=0.507) | -1.31pp (p=1.000) | -3.05pp [-9.04pp, +2.95pp] | same sign, within noise |
| 3b entity | entity '2024 US Election' vs rest | rated at all | -6.36pp (p=0.319) | -4.22pp (p=0.503) | -5.15pp [-11.40pp, +1.09pp] | same sign, within noise |
| 3c keyword | keyword 'politics/election' vs rest | H rate | -0.56pp (p=0.901) | -0.64pp (p=1.000) | -0.60pp [-4.43pp, +3.23pp] | same sign, within noise |
| 3c keyword | keyword 'politics/election' vs rest | rated at all | -1.02pp (p=0.820) | -2.18pp (p=0.569) | -1.65pp [-5.79pp, +2.50pp] | same sign, within noise |
| 3c keyword | keyword 'war/conflict' vs rest | H rate | -4.80pp (p=0.255) | +1.07pp (p=0.723) | -1.73pp [-6.18pp, +2.73pp] | flips |
| 3c keyword | keyword 'war/conflict' vs rest | rated at all | -1.27pp (p=0.883) | +1.10pp (p=0.752) | +0.10pp [-5.06pp, +5.25pp] | flips |
| 3c keyword | keyword 'health/science' vs rest | H rate | +3.44pp (p=0.388) | -1.95pp (p=0.810) | +0.49pp [-5.23pp, +6.20pp] | flips |
| 3c keyword | keyword 'health/science' vs rest | rated at all | +3.83pp (p=0.432) | -4.87pp (p=0.388) | -1.23pp [-7.16pp, +4.71pp] | flips |
| 3c keyword | keyword 'celebrity/entertainment' vs rest | H rate | +4.35pp (p=0.156) | -3.28pp (p=0.421) | +0.31pp [-4.05pp, +4.66pp] | flips |
| 3c keyword | keyword 'celebrity/entertainment' vs rest | rated at all | +1.09pp (p=0.726) | -4.92pp (p=0.277) | -1.95pp [-6.54pp, +2.64pp] | flips |
| 3c keyword | keyword 'sports' vs rest | H rate | +0.14pp (p=1.000) | +0.67pp (p=0.831) | +0.40pp [-4.77pp, +5.57pp] | same sign, within noise |
| 3c keyword | keyword 'sports' vs rest | rated at all | -0.24pp (p=1.000) | +2.27pp (p=0.568) | +0.91pp [-4.84pp, +6.65pp] | flips |
| 3c keyword | keyword 'crypto/finance' vs rest | H rate | +6.66pp (p=0.200) | -9.62pp (p=0.069) | -6.46pp [-11.36pp, -1.57pp] | flips |
| 3c keyword | keyword 'crypto/finance' vs rest | rated at all | +9.23pp (p=0.120) | -9.59pp (p=0.112) | -4.43pp [-10.76pp, +1.90pp] | flips |
| 3c keyword | keyword 'AI/tech' vs rest | H rate | +0.71pp (p=0.820) | -1.64pp (p=1.000) | -0.81pp [-7.23pp, +5.60pp] | flips |
| 3c keyword | keyword 'AI/tech' vs rest | rated at all | -0.45pp (p=1.000) | +1.56pp (p=0.664) | +0.71pp [-6.69pp, +8.11pp] | flips |
| 3c keyword | keyword 'no keyword matched' vs rest | H rate | -2.74pp (p=0.203) | +1.86pp (p=0.361) | -0.25pp [-3.04pp, +2.53pp] | flips |
| 3c keyword | keyword 'no keyword matched' vs rest | rated at all | -1.37pp (p=0.563) | +2.41pp (p=0.307) | +0.65pp [-2.44pp, +3.74pp] | flips |
| 4a velocity | trend across velocity bands | H rate | -0.36pp/band (p=0.773) | +0.22pp/band (p=0.834) | -0.02pp [-1.60pp, +1.56pp] | flips |
| 4a velocity | trend across velocity bands | rated at all | +0.78pp/band (p=0.574) | +0.95pp/band (p=0.420) | +0.88pp [-0.88pp, +2.63pp] | same sign, within noise |
| 4b feed size | trend across small / large / xl | H rate | -0.61pp/band (p=0.704) | +0.24pp/band (p=0.878) | -0.17pp [-2.35pp, +2.01pp] | flips |
| 4b feed size | trend across small / large / xl | rated at all | -2.61pp/band (p=0.138) | +1.58pp/band (p=0.360) | -0.47pp [-2.89pp, +1.94pp] | flips |
| 5 age | trend across <3h / 3-12h / 12-24h | H rate | -2.70pp/band (p=0.080) | -2.68pp/band (p=0.060) | -2.69pp [-4.74pp, -0.64pp] | holds (both periods) |
| 5 age | trend across <3h / 3-12h / 12-24h | rated at all | -1.82pp/band (p=0.283) | -2.40pp/band (p=0.135) | -2.12pp [-4.41pp, +0.16pp] | same sign, within noise |
| 5 age | 3-12h vs other ages (the old 'fresh' flag) | H rate | +0.92pp (p=0.715) | +1.40pp (p=0.492) | +1.18pp [-1.60pp, +3.97pp] | same sign, within noise |
| 5 age | 3-12h vs other ages (the old 'fresh' flag) | rated at all | -0.36pp (p=0.934) | +1.12pp (p=0.682) | +0.43pp [-2.67pp, +3.53pp] | flips |
| 6 followers | trend across follower bands | H rate | -1.11pp/band (p=0.287) | -0.70pp/band (p=0.464) | -0.89pp [-2.27pp, +0.49pp] | same sign, within noise |
| 6 followers | trend across follower bands | rated at all | -0.04pp/band (p=0.975) | -0.50pp/band (p=0.644) | -0.28pp [-1.81pp, +1.25pp] | same sign, within noise |
| 6 followers | under 1M vs 1M+ (the old 'small author' flag) | H rate | +8.14pp (p=0.013) | +2.52pp (p=0.582) | +5.61pp [+1.86pp, +9.37pp] | holds in sign (A carries it) |
| 6 followers | under 1M vs 1M+ (the old 'small author' flag) | rated at all | +6.19pp (p=0.112) | +4.48pp (p=0.252) | +5.29pp [+0.95pp, +9.63pp] | holds in sign (A carries it) |
| 7a media | any media vs none | H rate | +6.30pp (p=0.010) | +2.88pp (p=0.233) | +4.51pp [+1.55pp, +7.47pp] | holds in sign (A carries it) |
| 7a media | any media vs none | rated at all | +1.82pp (p=0.559) | +0.65pp (p=0.906) | +1.20pp [-2.36pp, +4.75pp] | same sign, within noise |
| 7a media | video vs photo | H rate | -1.53pp (p=0.549) | +1.59pp (p=0.522) | +0.18pp [-3.17pp, +3.53pp] | flips |
| 7a media | video vs photo | rated at all | -0.84pp (p=0.777) | +1.91pp (p=0.480) | +0.64pp [-2.97pp, +4.24pp] | flips |
| 7b reply | reply vs not | H rate | +37.08pp (p=0.006) | -3.04pp (p=1.000) | +5.40pp [-7.61pp, +18.41pp] | too few to tell |
| 7b reply | reply vs not | rated at all | +33.61pp (p=0.015) | -5.84pp (p=0.709) | +2.48pp [-10.56pp, +15.52pp] | too few to tell |
| 7b quote | quote vs not | H rate | -4.96pp (p=0.087) | -1.30pp (p=0.663) | -3.05pp [-6.44pp, +0.35pp] | same sign, within noise |
| 7b quote | quote vs not | rated at all | -0.17pp (p=1.000) | -0.36pp (p=1.000) | -0.28pp [-4.31pp, +3.76pp] | same sign, within noise |
| 8 reply ratio | trend across reply-ratio terciles | H rate | +1.41pp/band (p=0.282) | -0.21pp/band (p=0.857) | +0.51pp [-1.20pp, +2.21pp] | flips |
| 8 reply ratio | trend across reply-ratio terciles | rated at all | +1.07pp/band (p=0.457) | -1.05pp/band (p=0.423) | -0.09pp [-1.99pp, +1.81pp] | flips |
| 8 quote ratio | trend across quote-ratio terciles | H rate | +0.23pp/band (p=0.860) | +1.28pp/band (p=0.271) | +0.82pp [-0.89pp, +2.53pp] | same sign, within noise |
| 8 quote ratio | trend across quote-ratio terciles | rated at all | +0.53pp/band (p=0.713) | +1.54pp/band (p=0.238) | +1.09pp [-0.81pp, +2.98pp] | same sign, within noise |
| 9 lang | en vs other | H rate | +13.30pp (p=1.000) | +9.25pp (p=1.000) | +11.73pp [-21.51pp, +44.97pp] | too few to tell |
| 9 lang | en vs other | rated at all | +16.75pp (p=1.000) | +12.00pp (p=1.000) | +14.91pp [-18.34pp, +48.16pp] | too few to tell |
| 10 eval score | trend across the four scored bands | H rate | +2.86pp/band (p=0.005) | +2.18pp/band (p=0.026) | +2.51pp [+1.12pp, +3.89pp] | holds (both periods) |
| 10 eval score | trend across the four scored bands | rated at all | +1.33pp/band (p=0.236) | +2.10pp/band (p=0.056) | +1.72pp [+0.19pp, +3.26pp] | holds in sign (B carries it) |

Counts: {'H rate: flips': 22, 'H rate: holds (both periods)': 4, 'H rate: holds in sign (A carries it)': 7, 'H rate: holds in sign (B carries it)': 1, 'H rate: same sign, within noise': 17, 'H rate: too few to tell': 2, 'rated at all: flips': 23, 'rated at all: holds (both periods)': 2, 'rated at all: holds in sign (A carries it)': 3, 'rated at all: holds in sign (B carries it)': 1, 'rated at all: same sign, within noise': 22, 'rated at all: too few to tell': 2}

## Not screened

- Polarity / partisanship of the post or author: needs an LLM or X's rater-factor data. Not available, not invented.
- Anything about the note text itself (length, sources, tone) other than the evaluation score benchmark.
- A/B arm effects (`ab_test_picks`): pulled but not screened; arms changed over time and are a separate question.
- Multivariate models, interactions, and the 4-flag rule as a combined rule (its component flags appear in 4a, 5, 6, 7a).
- Refreshed engagement columns (impressions/likes/retweets/replies) were deliberately not pulled: they leak the future.
