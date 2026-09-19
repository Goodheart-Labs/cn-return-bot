# LLM rater: an out-of-sample P(Helpful) forecast from the tweet and note text (2026-09-18)

Hand-written summary; every number below is copied from the generated tables. Rerun with `uv run evaluate.py` (this section is preserved).

**Test set.** 506 notes submitted 2026-09-01 to 09-11 18:39 UTC — my test period intersected with the 977 notes `predictions.parquet` scores, so every forecaster is scored on the identical notes. H 43 (8.5%), NH 19 (3.8%). The rater is never fitted, so all 2,045 matured notes are out of sample for it; only the raw-to-probability map is fitted, on 2026-08-07 to 08-31, never on a September note. 2,045 of 2,046 matured notes rated, 0 failed calls, $4.45.

| forecaster (target) | Brier | Brier diff vs `prior_30d` [note bootstrap 95%] | excludes 0? | log loss | AUC |
|---|---|---|---|---|---|
| `llm_raw` (H) | 0.14113 | +0.06222 [+0.04780, +0.07715] | yes, worse | 0.4436 | 0.601 |
| `llm_platt` (H) | 0.07895 | +0.00004 [-0.00209, +0.00217] | **no** | 0.2940 | 0.601 |
| `prior_30d` (H) | 0.07891 | ref | - | 0.2968 | 0.592 |
| `stable4` (H) | 0.07958 | +0.00067 [-0.00116, +0.00250] | no | 0.2977 | 0.584 |
| `stable4_platt` (H) | 0.07832 | -0.00058 [-0.00089, -0.00027] | yes, better | 0.2937 | 0.592 |
| `llm_platt` (NH) | 0.03587 | -0.00027 [-0.00097, +0.00029] | **no** | 0.1565 | 0.656 |
| `prior_30d` (NH) | 0.03613 | ref | - | 0.1599 | 0.563 |
| `stable4` (NH) | 0.03589 | -0.00024 [-0.00090, +0.00044] | no | 0.1536 | 0.694 |

**Calibration.** Raw, the model says 29.6% H against 8.2% observed — a +21.4pp level error that costs it 79% of the base rate's Brier. After the August-fitted Platt map: H 12.7% predicted vs 8.2% observed (+4.6pp, slope 0.93 [0.10, 1.76], 10th-90th pct 6.5% to 18.0%); NH 2.6% vs 3.6% (-1.0pp, slope 1.21 [0.30, 2.12]). The residual H over-prediction is the same drift that hurt every lagged baseline: the rate fell again between the two blocks.
**Does it add to `stable4`?** No. Fit on August, tested on the same 506 notes: H Brier 0.08011 to 0.08060 (+0.00049 [-0.00124, +0.00224]); NH 0.03584 to 0.03550 (-0.00034 [-0.00106, +0.00025]). Both intervals include zero. The NH AUC does rise, 0.681 to 0.723.
**Graded vs binary `engages`.** Graded separates NH better than the pipeline's binary flag (AUC 0.626 vs 0.559) but the difference is +0.067 [-0.003, +0.133] and includes zero; its bottom quintile runs NH 5.6% [3.8, 8.3] on 409 notes against the binary 0-bucket's 8.1% [4.6, 14.0] on 135. For H the graded score holds signal the binary flag has none of (AUC difference -0.049 [-0.081, -0.016], excludes zero: more engagement, more helpful) but the relation is not monotone and peaks in Q3-Q4. Fit on August and tested on September alone, neither version beats the base rate with an interval excluding zero.
**Bottom line.** The rater ranks a little — AUC 0.60 for H (the highest of anything tried here) and 0.66 for NH — but once the level is corrected it beats nothing: every Brier interval against `prior_30d` includes zero, on 43 H and 19 NH positives, and it does not add to `stable4`. Meanwhile `stable4_platt`, which needs no LLM, does clear zero on H in this window. Read the AUCs as a hint worth another month of notes, not a result.

## Method and honesty notes

- **One prompt, one run.** The prompt was written before any outcome was looked at and was never changed. There is no second run to report. The topic list was fixed up front (section 2) and nothing is fitted on topic.
- **The only outcome-derived thing in the prompt** is the constant sentence "about 1 in 10 rated helpful, about 1 in 30 rated not helpful", which is the same in all 2,045 calls and carries no per-note information. It is an anchor, as the brief asked for; it is declared because it is population-level leakage from labels the model would not have had in advance.
- **Leak points checked.** (1) The prompt builder takes four whitelisted strings and nothing else — an assert in `rate.py` pins that list, and section 2 prints the templates verbatim. (2) No recalibrator, logistic or bin boundary is fitted on a test-period note; the August/September boundary is a date, not a random split, because the base rate drifts down. (3) The headline set is the intersection with `predictions.parquet`'s own scored set, so no forecaster is scored on notes another was not. (4) Labels come from one source (my fresher `cn_status`) for every forecaster; it disagrees with the frozen `y` on 1 of 506 notes.
- **Known soft spots.** The binary `materiality_engages` judge saw the search findings; this rater did not, so section 9 compares two judges rather than two encodings of one. The engages quintiles are lumpy because the graded score piles up at 85-95. The 0-bucket NH result the graded score is being tested against was itself found post hoc today, so it is not a clean prior. About 30 intervals are computed below; at 95% roughly 1.5 would clear by chance.
- **Not done.** No prompt variants, no ensembling, no few-shot examples, no use of the note's sources beyond their URLs, no reasoning-effort sweep, no model comparison.

<!-- AUTO-GENERATED BELOW THIS LINE BY evaluate.py; edits below are overwritten -->

## 1. Sanity checks, joins and cost

- Pull time (DB `now()`): **2026-09-19 03:50:03.029471+00:00**. Maturity cutoff = pull time minus 7 days = **2026-09-12 03:50:03.029471+00:00**.
- `notes` rows with `coalesce(submitted_at, first_seen_at) >= 2026-08-07`: 2190; matured (before the cutoff): **2046**; distinct tweets 2046 (one note per tweet: True).
- `cn_status` in the matured set: {'NEEDS_MORE_RATINGS': 1754, 'CURRENTLY_RATED_HELPFUL': 226, 'CURRENTLY_RATED_NOT_HELPFUL': 61, '(null)': 5}. H = CURRENTLY_RATED_HELPFUL, NH = CURRENTLY_RATED_NOT_HELPFUL, everything else (including null) is unresolved.
- Join to the submitting `pipeline_runs` row on `note_id`: 2045 of 2046; note_text non-empty 2045.
- Tweet text source: {'feed_tweets': 1976, 'tweets': 70} (feed_tweets first, `tweets` as the fallback; the column is kept in the data).
- `author_handle`: non-null in **0** of 2046 rows in *both* `feed_tweets` and `tweets` (the same finding as the sibling screen). The prompt therefore says `(handle not recorded)`; no handle was shown to the model.
- `materiality_engages` present for 2044 of 2046 (value counts {1.0: 1909, 0.0: 135, nan: 2}).
- Source URLs parsed from `pipeline_runs.source_url`: {0: 1, 1: 660, 2: 1132, 3: 241, 4: 11, 5: 1} (urls per note).
- LLM calls: 2045 successful, 0 permanently failed, 1 matured notes with no rating (these are the ones with no note text / tweet text, so no prompt could be built).
- **Total OpenRouter cost: $4.4490** (google/gemini-3.8-flash); prompt tokens 1,940,209, completion tokens 798,352. Cost is OpenRouter's own `usage.cost`, not an estimate.
- Rated set used below: **2045** notes, H 226, NH 61.

| block | window | n | H | H rate | NH | NH rate |
|---|---|---|---|---|---|---|
| fit (Platt/isotonic/logistic fitted here) | 2026-08-07 00:06 to 2026-08-31 23:32 | 1519 | 183 | 12.0% | 42 | 2.8% |
| test (everything reported below) | 2026-09-01 04:00 to 2026-09-12 03:04 | 526 | 43 | 8.2% | 19 | 3.6% |

## 2. Exactly what the prompt contained

Four strings and nothing else, assembled by `build_prompt()` in `rate.py` from a whitelisted column list (`PROMPT_COLS = tweet_text, author_handle, note_text, urls`):

1. the tweet text (first-sight `feed_tweets.text`, else `tweets.text`);
2. the author handle — **NULL in the database for every row**, so literally `(handle not recorded)`;
3. the note text (`pipeline_runs.note_text` of the submitting run);
4. the note's source URLs (parsed out of `pipeline_runs.source_url`).

Not in the prompt: the outcome, `cn_status`, any rating or view count, the submission date or time, the note's age, any pipeline score (evaluation, materiality, check), the A/B arm, the bot name, competing notes, author followers, feed tier, impressions, or anything else that happened after submission. The base-rate sentence in the system prompt ('about 1 in 10 helpful, about 1 in 30 not helpful') is a constant across all 2,045 calls and carries no per-note information, but it is outcome-derived at the population level and is declared here for that reason.

Verbatim system prompt:

```
You forecast how X (Twitter) Community Notes raters will rate a proposed note.

A note is shown to raters of differing viewpoints. It reaches CURRENTLY_RATED_HELPFUL only if enough raters who usually disagree with each other all rate it helpful. Most notes never get enough ratings and stay at NEEDS_MORE_RATINGS. A few are rated CURRENTLY_RATED_NOT_HELPFUL.

Base rates in this exact feed of notes: about 1 in 10 end up rated helpful, and about 1 in 30 end up rated not helpful. The rest stay unrated. Anchor on those base rates and move away from them only when the note in front of you gives you a reason to.

You are given only the post, the proposed note, and the note's sources. You do not know what happened next. Judge from the text alone. Be calibrated, not charitable: a well-written note is still usually unrated.
```

Verbatim user template (`{handle}`, `{tweet}`, `{note}`, `{urls}`, `{topics}` substituted):

```
POST by {handle}:
<post>
{tweet}
</post>

PROPOSED COMMUNITY NOTE:
<note>
{note}
</note>

NOTE'S SOURCE URLS:
{urls}

Return one JSON object:
- p_helpful: integer 0-100, the probability this note ends up CURRENTLY_RATED_HELPFUL.
- p_not_helpful: integer 0-100, the probability it ends up CURRENTLY_RATED_NOT_HELPFUL.
- topic: exactly one of {topics}.
- engages: integer 0-100, how directly the note addresses the post's central claim (100 = it rebuts the claim the post's argument rests on; 0 = it corrects only a side detail, or the post makes no factual claim at all).
- reason: one sentence, at most 25 words.
```

Topic list, fixed before any outcome was looked at: `politics_us, politics_world, war_conflict, health_medicine, science_environment, ai_tech, business_finance, crypto, celebrity_entertainment, sports, crime_justice, other`.

Model `google/gemini-3.8-flash`, temperature 0, strict JSON schema, one call per note, up to 5 retries on transient errors, every answer appended to `data/ratings.jsonl` as it lands. The first 713 calls ran at 8 concurrent; throughput fell to ~15/min so the remainder ran at 20. Concurrency changes nothing about the prompt or the answers.

## 3. Raw calibration of the rater on every matured note

The rater is never fitted, so all 2045 matured notes are out of sample for it. No recalibration anywhere in this section.

| target | block | n | positives | observed rate | mean predicted | Brier | log loss | AUC |
|---|---|---|---|---|---|---|---|---|
| H | all matured | 2045 | 226 | 11.1% | 27.4% | 0.14121 | 0.4465 | 0.598 |
| H | fit block (Aug) | 1519 | 183 | 12.0% | 26.7% | 0.14102 | 0.4471 | 0.604 |
| H | test block (Sep) | 526 | 43 | 8.2% | 29.6% | 0.14176 | 0.4450 | 0.597 |
| NH | all matured | 2045 | 61 | 3.0% | 14.9% | 0.05186 | 0.2181 | 0.648 |
| NH | fit block (Aug) | 1519 | 42 | 2.8% | 15.2% | 0.05203 | 0.2187 | 0.646 |
| NH | test block (Sep) | 526 | 19 | 3.6% | 14.0% | 0.05136 | 0.2166 | 0.658 |

- **H**, all matured: calibration-in-the-large 27.4% predicted vs 11.1% observed (over-prediction of +16.4pp); calibration slope 0.39 [0.24, 0.53]; sharpness (10th-90th pct of predictions) 6.0% to 48.0%.
- **NH**, all matured: calibration-in-the-large 14.9% predicted vs 3.0% observed (over-prediction of +11.9pp); calibration slope 0.59 [0.31, 0.87]; sharpness (10th-90th pct of predictions) 6.0% to 28.0%.

Raw prediction distributions (percentiles of the integer the model returned), all matured notes:

| field | min | p1 | p5 | p10 | p25 | p50 | p75 | p90 | p95 | p99 | max | distinct values |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p_helpful | 1 | 2 | 4 | 6 | 14 | 25 | 42 | 48 | 58 | 68 | 78 | 43 |
| p_not_helpful | 3 | 4 | 5 | 6 | 7 | 12 | 18 | 28 | 35 | 65 | 85 | 33 |
| engages | 15 | 35 | 65 | 75 | 85 | 95 | 95 | 95 | 100 | 100 | 100 | 24 |

## 4. Recalibration fitted on 2026-08-07 to 2026-08-31, applied to 2026-09-01 onward

- **H**: Platt fitted on 1519 August notes (183 positives); intercept -1.549, slope 0.408. Isotonic fitted on the same notes. Neither ever sees a September note. On the test block the Platt map turns a mean raw prediction of 29.6% into 12.7% (observed 8.2%).
- **NH**: Platt fitted on 1519 August notes (42 positives); intercept -2.566, slope 0.570. Isotonic fitted on the same notes. Neither ever sees a September note. On the test block the Platt map turns a mean raw prediction of 14.0% into 2.6% (observed 3.6%).

## 5. Headline comparison on the identical note set

- `predictions.parquet` scores **977** notes (2026-08-23 07:00 to 2026-09-11 18:39 UTC).
- My test period is 2026-09-01 onward. The intersection — scored there **and** in my test period — is **506 notes**: H 43 (8.5%), NH 19 (3.8%).
- Test notes dropped because the baselines never predicted them: **20** (submitted after the baselines' own maturity cutoff of 2026-09-11 19:05 UTC; my pull is ~9h later).
- Labels: I use my own fresher `cn_status` for every forecaster, so the comparison is apples to apples. It disagrees with the `y` frozen in `predictions.parquet` on **1** of 506 notes.

### Target H — 506 notes, 43 positives (8.5%)

| forecaster | Brier | skill vs prior_30d | Brier diff vs prior_30d [bootstrap 95%] | excludes 0? | log loss | AUC |
|---|---|---|---|---|---|---|
| `llm_raw` | 0.14113 | -78.9% | +0.06222 [+0.04780, +0.07715] | yes, worse | 0.4436 | 0.601 |
| `llm_platt` | 0.07895 | -0.1% | +0.00004 [-0.00209, +0.00217] | no | 0.2940 | 0.601 |
| `llm_isotonic` | 0.07903 | -0.2% | +0.00013 [-0.00294, +0.00317] | no | 0.2920 | 0.587 |
| `prior_all` | 0.07906 | -0.2% | +0.00015 [+0.00003, +0.00028] | yes, worse | 0.2975 | 0.570 |
| `prior_30d` | 0.07891 | ref | ref | - | 0.2968 | 0.592 |
| `eval_only` | 0.07897 | -0.1% | +0.00006 [-0.00086, +0.00100] | no | 0.2966 | 0.569 |
| `stable4` | 0.07958 | -0.9% | +0.00067 [-0.00116, +0.00250] | no | 0.2977 | 0.584 |
| `stable4_platt` | 0.07832 | +0.7% | -0.00058 [-0.00089, -0.00027] | yes, better | 0.2937 | 0.592 |
| `gbm_canary` | 0.08400 | -6.5% | +0.00509 [+0.00238, +0.00782] | yes, worse | 0.3147 | 0.485 |

### Target NH — 506 notes, 19 positives (3.8%)

| forecaster | Brier | skill vs prior_30d | Brier diff vs prior_30d [bootstrap 95%] | excludes 0? | log loss | AUC |
|---|---|---|---|---|---|---|
| `llm_raw` | 0.05225 | -44.6% | +0.01612 [+0.00787, +0.02360] | yes, worse | 0.2192 | 0.656 |
| `llm_platt` | 0.03587 | +0.7% | -0.00027 [-0.00097, +0.00029] | no | 0.1565 | 0.656 |
| `llm_isotonic` | 0.03583 | +0.8% | -0.00031 [-0.00099, +0.00030] | no | 0.1555 | 0.652 |
| `prior_all` | 0.03615 | -0.0% | +0.00002 [-0.00009, +0.00010] | no | 0.1602 | 0.525 |
| `prior_30d` | 0.03613 | ref | ref | - | 0.1599 | 0.563 |
| `eval_only` | 0.03659 | -1.3% | +0.00046 [+0.00018, +0.00079] | yes, worse | 0.1665 | 0.448 |
| `stable4` | 0.03589 | +0.7% | -0.00024 [-0.00090, +0.00044] | no | 0.1536 | 0.694 |
| `stable4_platt` | 0.03598 | +0.4% | -0.00016 [-0.00064, +0.00030] | no | 0.1558 | 0.702 |
| `gbm_canary` | 0.03749 | -3.7% | +0.00135 [-0.00016, +0.00298] | no | 0.1684 | 0.581 |

Brier difference is forecaster minus `prior_30d`, so negative is better. 2000 note-level bootstrap resamples, the same resamples for every row. Probabilities clipped to [0.001, 0.999] before every metric.

## 6. Calibration on the test block

**H, raw** — quantile bins on the 526 test notes:

| bin | n | mean predicted | positives | observed | Wilson 95% |
|---|---|---|---|---|---|
| Q1 | 106 | 7.2% | 3 | 2.8% | [1.0%, 8.0%] |
| Q2 | 105 | 18.1% | 11 | 10.5% | [6.0%, 17.8%] |
| Q3 | 105 | 28.6% | 8 | 7.6% | [3.9%, 14.3%] |
| Q4 | 105 | 39.9% | 8 | 7.6% | [3.9%, 14.3%] |
| Q5 | 105 | 54.4% | 13 | 12.4% | [7.4%, 20.0%] |

- calibration-in-the-large: 29.6% predicted vs 8.2% observed (+21.4pp); slope 0.38 [0.04, 0.72]; sharpness 10th-90th pct 6.0% to 52.0%.

**H, Platt (fitted on August)** — quantile bins on the 526 test notes:

| bin | n | mean predicted | positives | observed | Wilson 95% |
|---|---|---|---|---|---|
| Q1 | 106 | 6.8% | 3 | 2.8% | [1.0%, 8.0%] |
| Q2 | 105 | 10.2% | 11 | 10.5% | [6.0%, 17.8%] |
| Q3 | 105 | 12.7% | 8 | 7.6% | [3.9%, 14.3%] |
| Q4 | 105 | 15.2% | 8 | 7.6% | [3.9%, 14.3%] |
| Q5 | 105 | 18.7% | 13 | 12.4% | [7.4%, 20.0%] |

- calibration-in-the-large: 12.7% predicted vs 8.2% observed (+4.6pp); slope 0.93 [0.10, 1.76]; sharpness 10th-90th pct 6.5% to 18.0%.

**H, isotonic (fitted on August)** — quantile bins on the 526 test notes:

| bin | n | mean predicted | positives | observed | Wilson 95% |
|---|---|---|---|---|---|
| Q1 | 106 | 5.4% | 3 | 2.8% | [1.0%, 8.0%] |
| Q2 | 105 | 12.1% | 10 | 9.5% | [5.3%, 16.6%] |
| Q3 | 105 | 13.3% | 14 | 13.3% | [8.1%, 21.1%] |
| Q4 | 105 | 13.3% | 5 | 4.8% | [2.1%, 10.7%] |
| Q5 | 105 | 18.6% | 11 | 10.5% | [6.0%, 17.8%] |

- calibration-in-the-large: 12.5% predicted vs 8.2% observed (+4.3pp); slope 0.85 [0.20, 1.51]; sharpness 10th-90th pct 5.4% to 16.1%.

**NH, raw** — quantile bins on the 526 test notes:

| bin | n | mean predicted | positives | observed | Wilson 95% |
|---|---|---|---|---|---|
| Q1 | 106 | 5.2% | 1 | 0.9% | [0.2%, 5.2%] |
| Q2 | 105 | 7.6% | 1 | 1.0% | [0.2%, 5.2%] |
| Q3 | 105 | 11.8% | 7 | 6.7% | [3.3%, 13.1%] |
| Q4 | 105 | 16.1% | 4 | 3.8% | [1.5%, 9.4%] |
| Q5 | 105 | 29.3% | 6 | 5.7% | [2.6%, 11.9%] |

- calibration-in-the-large: 14.0% predicted vs 3.6% observed (+10.4pp); slope 0.69 [0.17, 1.21]; sharpness 10th-90th pct 6.0% to 25.0%.

**NH, Platt (fitted on August)** — quantile bins on the 526 test notes:

| bin | n | mean predicted | positives | observed | Wilson 95% |
|---|---|---|---|---|---|
| Q1 | 106 | 1.4% | 1 | 0.9% | [0.2%, 5.2%] |
| Q2 | 105 | 1.8% | 1 | 1.0% | [0.2%, 5.2%] |
| Q3 | 105 | 2.4% | 7 | 6.7% | [3.3%, 13.1%] |
| Q4 | 105 | 2.9% | 4 | 3.8% | [1.5%, 9.4%] |
| Q5 | 105 | 4.6% | 6 | 5.7% | [2.6%, 11.9%] |

- calibration-in-the-large: 2.6% predicted vs 3.6% observed (-1.0pp); slope 1.21 [0.30, 2.12]; sharpness 10th-90th pct 1.6% to 3.9%.

**NH, isotonic (fitted on August)** — quantile bins on the 526 test notes:

| bin | n | mean predicted | positives | observed | Wilson 95% |
|---|---|---|---|---|---|
| Q1 | 106 | 0.8% | 0 | 0.0% | [0.0%, 3.5%] |
| Q2 | 105 | 1.6% | 3 | 2.9% | [1.0%, 8.1%] |
| Q3 | 105 | 2.5% | 7 | 6.7% | [3.3%, 13.1%] |
| Q4 | 105 | 3.1% | 3 | 2.9% | [1.0%, 8.1%] |
| Q5 | 105 | 5.1% | 6 | 5.7% | [2.6%, 11.9%] |

- calibration-in-the-large: 2.6% predicted vs 3.6% observed (-1.0pp); slope 0.98 [0.22, 1.74]; sharpness 10th-90th pct 0.8% to 3.5%.

## 7. Does the LLM probability add anything to `stable4`?

- Features come from the sibling screen's joins (read-only import). They exist for 2025 of 2045 rated notes; the 20 misses are notes submitted after the sibling's own maturity cutoff (2026-09-11 19:05:05.661760+00:00), which its `build()` never produced.
- Fitted on **1519** August notes, tested on **506** September notes. Missing feature values are imputed with the training-block median only.

| target | model (fit Aug, test Sep) | Brier | Brier diff vs stable4 [bootstrap 95%] | excludes 0? | log loss | AUC |
|---|---|---|---|---|---|---|
| H | stable4 | 0.08011 | ref | - | 0.3228 | 0.562 |
| H | stable4 + LLM p | 0.08060 | +0.00049 [-0.00124, +0.00224] | no | 0.3171 | 0.582 |
| H | LLM p alone (Platt) | 0.07895 | -0.00116 [-0.00473, +0.00232] | no | 0.2940 | 0.601 |
| NH | stable4 | 0.03584 | ref | - | 0.1571 | 0.681 |
| NH | stable4 + LLM p | 0.03550 | -0.00034 [-0.00106, +0.00025] | no | 0.1542 | 0.723 |
| NH | LLM p alone (Platt) | 0.03587 | +0.00003 [-0.00090, +0.00097] | no | 0.1565 | 0.656 |

## 8. Topic (descriptive only — nothing is fitted on topic)

Topics were fixed before any outcome was looked at. Cells with n < 30 are marked † and should not be read as evidence. August and September are shown separately so the drift in the base rate is visible.

**August block (2026-08-07 to 2026-08-31)** (n=1519)

| topic | n | H | H rate [Wilson 95%] | NH | NH rate [Wilson 95%] |
|---|---|---|---|---|---|
| politics_us | 260 | 20 | 7.7% [5.0%, 11.6%] | 4 | 1.5% [0.6%, 3.9%] |
| politics_world | 104 | 12 | 11.5% [6.7%, 19.1%] | 2 | 1.9% [0.5%, 6.7%] |
| war_conflict | 77 | 6 | 7.8% [3.6%, 16.0%] | 7 | 9.1% [4.5%, 17.6%] |
| health_medicine | 65 | 9 | 13.8% [7.5%, 24.3%] | 1 | 1.5% [0.3%, 8.2%] |
| science_environment | 64 | 8 | 12.5% [6.5%, 22.8%] | 1 | 1.6% [0.3%, 8.3%] |
| ai_tech | 81 | 13 | 16.0% [9.6%, 25.5%] | 4 | 4.9% [1.9%, 12.0%] |
| business_finance | 45 | 6 | 13.3% [6.3%, 26.2%] | 2 | 4.4% [1.2%, 14.8%] |
| crypto † | 9 | 0 | 0.0% [0.0%, 29.9%] | 0 | 0.0% [0.0%, 29.9%] |
| celebrity_entertainment | 399 | 53 | 13.3% [10.3%, 17.0%] | 5 | 1.3% [0.5%, 2.9%] |
| sports | 215 | 21 | 9.8% [6.5%, 14.5%] | 4 | 1.9% [0.7%, 4.7%] |
| crime_justice | 97 | 13 | 13.4% [8.0%, 21.6%] | 8 | 8.2% [4.2%, 15.4%] |
| other | 103 | 22 | 21.4% [14.5%, 30.2%] | 4 | 3.9% [1.5%, 9.6%] |
| (all) | 1519 | 183 | 12.0% [10.5%, 13.8%] | 42 | 2.8% [2.1%, 3.7%] |

**September block (2026-09-01 onward)** (n=526)

| topic | n | H | H rate [Wilson 95%] | NH | NH rate [Wilson 95%] |
|---|---|---|---|---|---|
| politics_us | 91 | 5 | 5.5% [2.4%, 12.2%] | 2 | 2.2% [0.6%, 7.7%] |
| politics_world | 56 | 4 | 7.1% [2.8%, 17.0%] | 2 | 3.6% [1.0%, 12.1%] |
| war_conflict | 39 | 3 | 7.7% [2.7%, 20.3%] | 1 | 2.6% [0.5%, 13.2%] |
| health_medicine † | 12 | 0 | 0.0% [0.0%, 24.2%] | 0 | 0.0% [0.0%, 24.2%] |
| science_environment † | 20 | 3 | 15.0% [5.2%, 36.0%] | 0 | 0.0% [0.0%, 16.1%] |
| ai_tech | 44 | 6 | 13.6% [6.4%, 26.7%] | 3 | 6.8% [2.3%, 18.2%] |
| business_finance † | 15 | 0 | 0.0% [0.0%, 20.4%] | 0 | 0.0% [0.0%, 20.4%] |
| crypto † | 2 | 0 | 0.0% [0.0%, 65.8%] | 0 | 0.0% [0.0%, 65.8%] |
| celebrity_entertainment | 100 | 7 | 7.0% [3.4%, 13.7%] | 6 | 6.0% [2.8%, 12.5%] |
| sports | 62 | 6 | 9.7% [4.5%, 19.5%] | 3 | 4.8% [1.7%, 13.3%] |
| crime_justice | 46 | 4 | 8.7% [3.4%, 20.3%] | 1 | 2.2% [0.4%, 11.3%] |
| other | 39 | 5 | 12.8% [5.6%, 26.7%] | 1 | 2.6% [0.5%, 13.2%] |
| (all) | 526 | 43 | 8.2% [6.1%, 10.8%] | 19 | 3.6% [2.3%, 5.6%] |

## 9. The graded `engages` score vs the pipeline's binary `materiality_engages`

Both signals present for **2044** of 2045 rated notes. The binary flag comes from the live pipeline's materiality judge (`google/gemini-3-flash-preview`), which saw the post, the note **and the search findings**; the graded score comes from this rater, which saw the post, the note and the source URLs only. So this is a comparison of two different judges, not of two encodings of one judge.

**All 2044 matured notes** (descriptive; the binary flag's split was found post hoc, the graded buckets are quintiles of a score fixed before any outcome was read):

| bucket | n | H | H rate [Wilson 95%] | NH | NH rate [Wilson 95%] | mean graded engages |
|---|---|---|---|---|---|---|
| binary flag = 0 | 135 | 14 | 10.4% [6.3%, 16.7%] | 11 | 8.1% [4.6%, 14.0%] | 62.0% |
| binary flag = 1 | 1909 | 211 | 11.1% [9.7%, 12.5%] | 50 | 2.6% [2.0%, 3.4%] | 90.3% |
| graded Q1 (15-85) | 409 | 31 | 7.6% [5.4%, 10.6%] | 23 | 5.6% [3.8%, 8.3%] | 68.9% |
| graded Q2 (85-90) | 409 | 37 | 9.0% [6.6%, 12.2%] | 12 | 2.9% [1.7%, 5.1%] | 87.8% |
| graded Q3 (90-95) | 408 | 60 | 14.7% [11.6%, 18.5%] | 9 | 2.2% [1.2%, 4.1%] | 93.6% |
| graded Q4 (95-95) | 409 | 58 | 14.2% [11.1%, 17.9%] | 9 | 2.2% [1.2%, 4.1%] | 95.0% |
| graded Q5 (95-100) | 409 | 39 | 9.5% [7.1%, 12.8%] | 8 | 2.0% [1.0%, 3.8%] | 97.1% |

Separation, all matured notes, scoring *lower engagement -> higher risk* (so AUC > 0.5 means low engagement predicts the outcome):

| target | AUC graded (LLM) | AUC binary (pipeline) | AUC difference [bootstrap 95%] | excludes 0? |
|---|---|---|---|---|
| H | 0.449 | 0.498 | -0.049 [-0.081, -0.016] | yes |
| NH | 0.626 | 0.559 | +0.067 [-0.003, +0.133] | no |

Out of sample: a one-feature logistic fitted on the 1518 August notes and tested on the 526 September notes. This is the honest version of the question.

| target | predictor (fit Aug, test Sep) | Brier | Brier diff vs base rate [bootstrap 95%] | excludes 0? | log loss | AUC |
|---|---|---|---|---|---|---|
| H | binary flag only | 0.07652 | +0.00000 [-0.00009, +0.00011] | no | 0.2907 | 0.500 |
| H | graded engages only | 0.07640 | -0.00012 [-0.00096, +0.00078] | no | 0.2887 | 0.522 |
| H | both | 0.07649 | -0.00003 [-0.00134, +0.00121] | no | 0.2886 | 0.527 |
| H | base rate (Aug) | 0.07652 | ref | - | 0.2907 | 0.500 |
| NH | binary flag only | 0.03456 | -0.00033 [-0.00102, +0.00022] | no | 0.1528 | 0.573 |
| NH | graded engages only | 0.03403 | -0.00086 [-0.00256, +0.00047] | no | 0.1516 | 0.567 |
| NH | both | 0.03398 | -0.00090 [-0.00262, +0.00045] | no | 0.1512 | 0.573 |
| NH | base rate (Aug) | 0.03489 | ref | - | 0.1566 | 0.500 |

