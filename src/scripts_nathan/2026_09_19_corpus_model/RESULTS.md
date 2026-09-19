# Learning from other people's notes, and forecasting who else will note the post (2026-09-19)

Two targets. **A**: train on the 26,443 notes other authors wrote, transfer to ours. **B**: at fetch time, predict whether another author will note the post. Hand-written summary; every number is copied from the generated tables below.

1. **The corpus is two populations and only one is usable.** 13,751 rows are a census (every other note on a tweet we noted, any status): 2,032 H / 362 NH / 10,906 NMR, **14.8% helpful**. The other 12,692 are "missed opportunity" rows that `updateNoteFeedback.ts` stage G inserts **only if currently rated helpful** — 86% of the table's 14,724 helpful rows are helpful by construction. The 56%-helpful headline is that filter, not a fact about notes. Usable positives: 2,032, about **9x our 227, not 60x**.
2. **In-corpus, H vs NMR, census only.** Primary TF-IDF+structural model: AUC **0.649** split by tweet (5-fold, grouped on tweet id and note-text hash), **0.621** split by time. Structural features alone 0.592/0.580; LSA-200 0.645/0.626; adding tweet text 0.646/0.616; H vs NH 0.861/0.847. Adding the stage-G rows as positives inflates it to 0.719 and the weights become tweet-id digits — that is the trap, shown in section 6.
3. **It transfers, on ranking.** Fitted on 9,985 corpus notes whose tweets are none of ours, scored on the identical 977 notes as the prior baselines: **AUC 0.598** (walk-forward 0.601) against `prior_30d` 0.534 and `stable4` 0.592. It ranks our notes better than anything built from our own 227 positives.
4. **It does not transfer on Brier.** Raw output is badly miscalibrated (mean 0.149 against a 9.2% base rate), Brier 0.08807. Walk-forward Platt: **0.08420 vs 0.08450, diff −0.00031 [−0.00146, +0.00073] — includes zero.** The brief's temporal recalibration (fit on 1,519 notes before 2026-09-01, test on the 507 of the 977 after it) gives 0.07954 vs 0.08028, **−0.00074 [−0.00218, +0.00065] — includes zero**, with a fitted slope of 0.43 rather than 1.
5. **It adds to `stable4` on ranking, not provably on Brier.** August fit, September test: AUC 0.566 → **0.600**, Brier diff **−0.00099 [−0.00224, +0.00024]**, includes zero. The corpus score alone beats `stable4` (AUC 0.608, Brier 0.07939).
6. **The selection did not eat it, and I checked four ways.** Spearman(score, note age) = **+0.000**. Within-tweet, comparing two notes on the *same* tweet, AUC **0.601** on 1,704 pairs — tweet-level selection cannot explain that. Post-hoc: the biggest negative weight `w:nnn` is contributor shorthand for "no note needed" and refitting on MISLEADING-class notes only collapses in-corpus AUC 0.649 → 0.581 **but leaves transfer at 0.596**; masking every digit (killing the tweet-id and date n-grams) leaves it at 0.604.
7. **One sanity check fails.** Our note's margin over the best competitor on the same tweet ranks our own outcome at AUC **0.485** — chance. The model scores our notes above the best competitor only 38% of the time. It ranks our notes against each other; it does not know whether ours beats theirs.
8. **Part A bottom line.** The corpus is worth roughly +0.06 AUC over `prior_30d` on H, robust to every artefact I could find, and free. It buys ranking, not calibration: no Brier interval excludes zero, and the level problem the prior backtest identified is untouched. Use it as a feature, not as a forecast.
9. **Part B: the second target is the better one.** Unit = one tweet we noted (2,046). Label = another author's note existed before our submit time: **1,380 positive (67.4%)**, against 227 for our own helpful. In our sample: earlier note present → 12.2% H / **1.3% NH**; we were first → 8.6% H / **6.5% NH**, a 4.9x difference. Nothing live shows this — unrated notes exist only in a dump published ~48 h late.
10. **It is predictable at fetch time.** August fit, September test, features frozen at first sight: AUC **0.620** (logistic on 27 numeric features), **0.627** with tweet text, **0.669** for the GBM. Calibration slope 0.50, so it is over-spread and needs shrinking. Top weights: note-request count, photo, impressions; negative: followers, velocity, tweet age.
11. **And the fetch-time score ranks our own outcomes.** On the identical 977: AUC for H **0.574**, beating both `prior_30d` (0.534) and the *realised* 48-hour-late `has_earlier` flag (0.547). For NOT-helpful, AUC 0.378 — the right sign — i.e. **0.622 read as "will avoid NH"**, and 0.638 once Platt-mapped. Quintiles of the score, out of sample: H rate 6.6% → 13.8% (monotone), NH rate **3.6% → 0.5%** (not monotone — it bumps to 4.1% at the middle quintile), realised earlier-note rate 50.5% → 88.8% (monotone).
12. **Part B Brier is also inconclusive, on 27 events.** `compete_platt` on NH: 0.02677 vs 0.02693, **−0.00016 [−0.00039, +0.00006]**, includes zero; log loss 0.1234 vs 0.1273. As a live stand-in for `has_earlier` inside `stable4` it recovers part of the gap on NH (AUC 0.465 → 0.545 against 0.681 for the real flag) and nothing on H.
13. **Honesty notes.** Statuses are not permanent: re-pulling `notes` 9 h after the prior backtest moved 1 of the 977 labels, so that file's `y` is the label of record throughout. 1 of 977 has no stored note text and gets the median score. Part B is trained only on tweets our pipeline chose to note, because for rejected tweets stage G records only competitors that ended up helpful — the label is unobservable there. 2,041 of 2,046 of our notes are in the public dump, so a missing competing-note row means no competitor, not censoring.
14. **What I did not do.** No sentence-transformer embeddings (LSA-200 stands in for the dense arm, and is reported beside the sparse one). No cross-validated hyperparameter search anywhere — everything was fixed up front and all seven pre-registered configurations are reported, plus four post-hoc diagnostics that are labelled as such.
15. **Overall.** Both targets beat our own-note models on ranking and neither beats `prior_30d` on Brier with an interval that excludes zero — which, on 90 helpful and 27 not-helpful events, is what an honest test of a 0.06-AUC effect should look like. The competition score (B) is the more valuable of the two: it is live, it is cheap, it has 1,380 positives instead of 227, and it points at the Not-Helpful rate, which is the thing we can actually act on at fetch time.

<!-- AUTO-GENERATED BELOW THIS LINE; edits below are overwritten by results.py -->

# PART A — Learning from other authors' notes (the transfer test)

## 1. What the corpus actually is

- `competing_notes` rows pulled: **26443** (26443 distinct `note_id`, 17444 distinct `tweet_id`). `created_at_millis` runs 2025-04-04 to 2026-09-16.
- `first_seen_date` is populated on only 2811 of 26443 rows, so every time cut below uses `created_at_millis` instead.

The table is filled by two different stages of `src/production/updateNoteFeedback.ts`, and they are not the same population:

| slice | how it is filled | rows | H | NH | NMR | null | H rate |
|---|---|---|---|---|---|---|---|
| census (`our_note_id` set) | stage F: **every** other note on a tweet where our own note appears in the dump, whatever its status | 13751 | 2032 | 362 | 10906 | 451 | 14.8% |
| missed (`our_note_id` NULL) | stage G: notes on tweets our pipeline **rejected**, `filter(currentStatus === HELPFUL)` | 12692 | 12692 | 0 | 0 | 0 | 100.0% |

**The headline 56% helpful is an artefact of stage G.** 12692 of the 14724 CURRENTLY_RATED_HELPFUL rows (86.2%) are missed-opportunity rows that are helpful *by construction* — the code inserts no other status. Every NOT_HELPFUL and every NEEDS_MORE_RATINGS row in the whole table sits in the census slice. Dropping stage G leaves 13751 notes at 14.8% helpful, which is the real rate for notes written by other people on the tweets we note.

So the usable positive count is **2032**, not 14,724: about 9x our own 227 rated-helpful notes, not 60x. Everything below trains on the census slice only; the census+missed pool is fitted once, in section 6, purely to show what it learns.

### 1a. Status against note age (the maturity confound)

A note's `current_status` depends on how long it has been rated. If helpfulness rose steeply with age the model could learn 'old note' rather than 'good note'.

| age of note at pull | n | H | NH | NMR | null | H rate [Wilson 95%] |
|---|---|---|---|---|---|---|
| 0-7d | 130 | 23 | 2 | 101 | 4 | 17.7% [12.1%, 25.2%] |
| 7-14d | 476 | 64 | 11 | 389 | 12 | 13.4% [10.7%, 16.8%] |
| 14-30d | 1222 | 207 | 24 | 949 | 42 | 16.9% [14.9%, 19.1%] |
| 30-60d | 2681 | 347 | 79 | 2185 | 70 | 12.9% [11.7%, 14.3%] |
| 60-120d | 3891 | 501 | 114 | 3080 | 196 | 12.9% [11.9%, 14.0%] |
| 120-240d | 3308 | 504 | 81 | 2630 | 93 | 15.2% [14.1%, 16.5%] |
| 240d+ | 2043 | 386 | 51 | 1572 | 34 | 18.9% [17.3%, 20.6%] |

The helpful rate is flat to within a few points from one week old to eight months old (Community Notes resolves in days, not months), so maturity is a small confound here, not the dominant one. Section 5 checks it again on the fitted scores.

### 1b. How the corpus differs from our own notes

| population | n | rated-helpful rate | mean note length (chars) | mean URLs per note |
|---|---|---|---|---|
| corpus census (H+NMR) | 12938 | 15.7% | 314 | 1.75 |
| our window notes (2026-08-07+) | 2046 | 11.0% | 396 | 1.87 |

- Tweet text found for 24614 of 26443 corpus rows (93.1%); 5808 rows from `feed_tweets`, 19142 from the `tweets` fallback, 1493 with no row in either.

**What population is this?** Notes written by other Community Notes contributors on the subset of tweets that (a) our feed surfaced, (b) our pipeline chose to note, and (c) X's public dump lists our note against. It is not a random sample of Community Notes. It is selected on the *tweet*, not on the note: conditional on a tweet being in it, every other author's note on that tweet is present with its true status. That is the property the within-tweet check in section 5 leans on.

## 2. A text model on other authors' notes

Every transform (both TF-IDF vectorizers, the structural standardiser, the top-domain list, the SVD) is fitted on the training rows of each fold only. Two splits are reported for every row.

- **Tweet split**: `GroupKFold(n_splits=5)`. The group label is a union-find over `tweet_id` **and** an md5 of the note text, so neither two notes on the same tweet nor two copies of the same note text can straddle a fold. A plain random split would leak: 9,697 of the 13,751 census notes share a tweet with another census note.
- **Time split**: train on corpus notes below the 75% quantile of `created_at_millis`, test on the rest. Fixed rule, chosen before any result was seen.

| model / target / pool | n | positives | AUC, tweet split (5-fold) | fold range | n train | n test | test pos | AUC, time split |
|---|---|---|---|---|---|---|---|---|
| `note_tfidf/H_vs_NMR/census` | 12938 | 2032 | **0.649** | 0.643-0.662 | 9703 | 3235 | 490 | **0.621** |
| `note_no_urls/H_vs_NMR/census` | 12938 | 2032 | **0.649** | 0.630-0.665 | 9703 | 3235 | 490 | **0.627** |
| `note_plus_tweet/H_vs_NMR/census` | 12938 | 2032 | **0.646** | 0.628-0.660 | 9703 | 3235 | 490 | **0.616** |
| `struct_only/H_vs_NMR/census` | 12938 | 2032 | **0.592** | 0.583-0.611 | 9703 | 3235 | 490 | **0.580** |
| `lsa200/H_vs_NMR/census` | 12938 | 2032 | **0.645** | 0.638-0.656 | 9703 | 3235 | 490 | **0.626** |
| `note_tfidf/H_vs_NH/census` | 2394 | 2032 | **0.861** | 0.833-0.895 | 1795 | 599 | 506 | **0.847** |
| `note_tfidf/H_vs_NMR/trap` | 25630 | 14724 | **0.719** | 0.710-0.732 | 19222 | 6408 | 3457 | **0.680** |

What each row is:

- `note_tfidf/H_vs_NMR/census` — **PRIMARY** word(1,2)+char_wb(3,5) TF-IDF on note text, + 14 structural features, + top-30 domain flags
- `note_no_urls/H_vs_NMR/census` — same, URLs stripped from the text and no domain flags (keeps the URL *count*)
- `note_plus_tweet/H_vs_NMR/census` — primary + a word TF-IDF on the tweet the note answers
- `struct_only/H_vs_NMR/census` — structural features + domain flags only, no n-grams
- `lsa200/H_vs_NMR/census` — 200-dim LSA of the same TF-IDF, heavily regularised (C=0.1) — the dense/'embedding' arm
- `note_tfidf/H_vs_NH/census` — primary features, helpful vs NOT helpful
- `note_tfidf/H_vs_NMR/trap` — primary features, but the missed-opportunity rows added as positives (**the trap**, section 6)

Time split cut: 2026-08-04 for the H-vs-NMR census pools.

## 3. The transfer test

- **Training pool for every transfer model:** census rows whose tweet is **not** one of the 2046 tweets our window notes sit on. That removes tweet-level contamination — otherwise a competitor's note on the very tweet we are scoring would be in training, and the shared topic words would leak. 13751 census rows drop to 10635; restricted to H/NMR that is **9985** notes, 1583 of them helpful (15.9%).
- Our own notes are never in `competing_notes` (the dump walk skips our author id; checked: 0 of our 8,830 note ids appear there), so there is no note-level overlap either.

- **Walk-forward version:** the corpus model is refitted for every UTC submit day D on the corpus notes **created before D minus 7 days**, so nothing the model sees was written or rated after our note went out. The corpus is old relative to our window — the training pool only moves from 9347 to 9862 notes across the 35 days — so this changes little, but it makes the score legal as a forecast. 35 refits.

- **Label drift.** Re-pulling `notes` 9 h after the prior backtest's pull moved 1 of the 977 labels (a note left CURRENTLY_RATED_HELPFUL). Statuses are not permanent. The prior backtest's `y` is used throughout so the comparison is exact.
- **Scored on the identical 977 notes** of the prior backtest (90 H, 27 NH, submitted 2026-08-23 to 2026-09-11); labels taken from that file. 1 of the 977 has no `pipeline_runs.note_text` and is given the median corpus score, so that every forecaster is scored on the same 977. Metrics excluding it are given below and are unchanged to 4 decimals.

### 3a. Where our notes land on the corpus model's scale

| population | n | mean corpus score | 10th | 50th | 90th | true helpful rate |
|---|---|---|---|---|---|---|
| our 977 scored notes | 977 | 0.149 | 0.064 | 0.137 | 0.252 | 9.2% |
| our matured window notes | 2046 | 0.152 | 0.064 | 0.135 | 0.261 | 11.0% |
| corpus pool (training rows, true rate) | 9985 | - | - | - | - | 15.9% |

### 3b. Scored against `prior_30d` on the identical 977 notes

Brier difference is forecaster minus `prior_30d`; negative is better. 2000-draw note-level bootstrap, percentile interval, same resamples for every row.

| forecaster | Brier | log loss | AUC | Brier diff vs prior_30d [95%] | excludes 0? |
|---|---|---|---|---|---|
| `prior_30d (reference)` | 0.08450 | 0.3118 | 0.534 | ref | - |
| `corpus_raw (static fit)` | 0.08807 | 0.3198 | 0.598 | +0.00356 [-0.00026, +0.00701] | no |
| `corpus_raw_wf (walk-forward)` | 0.08799 | 0.3196 | 0.601 | +0.00348 [-0.00047, +0.00702] | no |
| `corpus_wf_platt` | 0.08420 | 0.3097 | 0.589 | -0.00031 [-0.00146, +0.00073] | no |

- `corpus_raw (static fit)` — raw P(H|text) from the corpus; no calibration to our base rate
- `corpus_raw_wf (walk-forward)` — same, legal timing
- `corpus_wf_platt` — Platt on our own earlier notes, refit daily under the same 7-day label lag; active on 977 of 977

- Same corpus score against the other two targets on the same 977: AUC for NOT-helpful 0.544 (27 positives), AUC for rated-at-all 0.589 (117 positives).
- Dropping the one text-less note: Brier 0.08427, AUC 0.598 (n=976).

### 3c. Recalibrated on our own notes with a strictly temporal split

- Recalibrator fitted on **1519** of our matured window notes submitted before 2026-09-01 (183 helpful, 12.0%); tested on the **507** of the 977 submitted on or after it (44 helpful, 8.7%). Notes submitted 2026-08-23 to 2026-08-31 (470 of the 977) drop out of the test set.

| forecaster | n | Brier | log loss | AUC | Brier diff vs prior_30d [95%] | excludes 0? |
|---|---|---|---|---|---|---|
| `prior_30d` | 507 | 0.08028 | 0.3004 | 0.587 | ref | - |
| `corpus_raw` | 507 | 0.08475 | 0.3112 | 0.598 | +0.00447 [-0.00054, +0.00940] | no |
| `corpus_recal_2026-09-01` | 507 | 0.07954 | 0.2961 | 0.598 | -0.00074 [-0.00218, +0.00065] | no |

- Fitted recalibration: logit(p_recal) = -1.221 + 0.429 x logit(corpus score). A slope near 0 means the corpus score carries almost no information about our notes; a slope near 1 would mean the corpus model's log-odds transfer one-for-one.

## 4. Does the corpus score add anything to `stable4`?

- Fit on our matured August notes (**1519**, 183 helpful), tested on our matured September notes (**507**, 44 helpful). `stable4` = ['has_earlier', 'age_h', 'feed_missing', 'hist_noH', 'hist_H', 'eval_score', 'eval_missing']. The corpus score enters as its logit. Missing features are imputed with the August median and continuous features scaled with August mean/sd, as in the prior backtest.

| model | Brier (Sep) | log loss | AUC | coef on corpus logit |
|---|---|---|---|---|
| `stable4` | 0.08137 | 0.3258 | 0.566 | - |
| `stable4 + corpus_wf` | 0.08038 | 0.3238 | 0.600 | +0.247 |
| `corpus_wf alone` | 0.07939 | 0.2954 | 0.608 | +0.273 |

- Brier difference, `stable4 + corpus_wf` minus `stable4`, on the 507 September notes: **-0.00099 [-0.00224, +0.00024]** — includes zero. AUC 0.566 to 0.600.

## 5. Sanity checks: quality, or the selection?

### 5a. Does the score just track note age?

- Spearman(out-of-fold score, note age in days) = **+0.000**. Spearman(true label, note age) = +0.039.

| note age | n | mean out-of-fold score | true H rate |
|---|---|---|---|
| 0-14d | 577 | 0.156 | 15.1% |
| 14-30d | 1156 | 0.165 | 17.9% |
| 30-60d | 2532 | 0.143 | 13.7% |
| 60-120d | 3581 | 0.153 | 14.0% |
| 120-240d | 3134 | 0.152 | 16.1% |
| 240d+ | 1958 | 0.152 | 19.7% |

### 5b. Within-tweet comparison (tweet-level selection removed)

- Corpus tweets carrying both a helpful and a non-helpful note: **908**, giving **1704** within-tweet (helpful, not-helpful) pairs. The model puts the helpful one higher in **1024** of them: within-tweet AUC **0.601**. This uses out-of-fold scores only, and comparing two notes on the *same* tweet removes every tweet-level selection effect (topic, virality, whether our pipeline picked it, whether X's dump lists it).

- Same comparison on **our** notes: 1651 of our matured window notes sit on a tweet that also carries someone else's note. The model scores ours above the best competitor on that tweet 38.1% of the time. Our note's *margin* over the best competitor ranks our own helpful outcome with AUC **0.485** (vs 0.559 for the raw score on the same 1651 notes, 200 helpful).

### 5c. What the model actually learned (top 25 each way)

Weights of the **transfer model** — the primary variant fitted on the corpus pool that excludes our window tweets, i.e. the exact model scored in section 3. Word n-grams are `w:`, character n-grams `c:`, structural `s:`, domain flags `d:`. Features are TF-IDF scaled, so the coefficients are comparable within a block but not across blocks.

| # | pushes toward HELPFUL | weight | pushes toward NEEDS_MORE_RATINGS | weight |
|---|---|---|---|---|
| 1 | `w:this is` | +1.467 | `w:nnn` | -2.144 |
| 2 | `w:nasa` | +1.268 | `w:note` | -1.018 |
| 3 | `w:new` | +1.155 | `c: nn` | -0.871 |
| 4 | `w:not real` | +1.111 | `w:10` | -0.827 |
| 5 | `w:this` | +0.972 | `w:india` | -0.824 |
| 6 | `w:letter` | +0.962 | `w:office` | -0.821 |
| 7 | `w:altered` | +0.961 | `c:nnn` | -0.819 |
| 8 | `w:over` | +0.959 | `c: nnn` | -0.813 |
| 9 | `w:sleep` | +0.950 | `w:and has` | -0.802 |
| 10 | `w:has` | +0.938 | `w:nnn the` | -0.798 |
| 11 | `w:like` | +0.905 | `w:the image` | -0.792 |
| 12 | `w:may` | +0.874 | `w:2026 07` | -0.786 |
| 13 | `w:brain` | +0.831 | `w:season` | -0.776 |
| 14 | `w:depicts` | +0.829 | `w:joke` | -0.759 |
| 15 | `s:has_url` | +0.829 | `w:id` | -0.745 |
| 16 | `w:shooting` | +0.805 | `w:covid` | -0.743 |
| 17 | `w:the uk` | +0.796 | `w:by` | -0.712 |
| 18 | `w:athletes` | +0.794 | `c:als ` | -0.698 |
| 19 | `w:self` | +0.790 | `w:post` | -0.695 |
| 20 | `w:name` | +0.786 | `w:19` | -0.680 |
| 21 | `w:podcast` | +0.786 | `w:today` | -0.673 |
| 22 | `w:animal` | +0.760 | `w:04` | -0.671 |
| 23 | `w:batteries` | +0.754 | `w:30` | -0.666 |
| 24 | `w:cure` | +0.752 | `w:trump` | -0.659 |
| 25 | `w:on` | +0.752 | `w:or` | -0.656 |

Structural and domain features only, by absolute weight:

| feature | weight |
|---|---|
| `s:has_url` | +0.829 |
| `d:foxnews.com` | -0.593 |
| `d:cnn.com` | -0.404 |
| `d:people.com` | -0.385 |
| `d:theguardian.com` | -0.313 |
| `d:leadstories.com` | +0.294 |
| `d:espn.com` | +0.284 |
| `d:politifact.com` | -0.283 |
| `d:snopes.com` | +0.275 |
| `d:timesofindia.indiatimes.com` | +0.266 |
| `d:yahoo.com` | +0.264 |
| `d:reddit.com` | -0.257 |
| `d:nbcnews.com` | +0.239 |
| `s:n_urls` | +0.206 |
| `d:newsweek.com` | +0.204 |
| `d:hindustantimes.com` | -0.199 |
| `d:nytimes.com` | -0.197 |
| `d:reuters.com` | +0.188 |
| `d:aljazeera.com` | -0.175 |
| `d:britannica.com` | -0.168 |

## 6. The trap: what happens if you keep the missed-opportunity rows

Same features, same hyperparameters, but the 12,692 stage-G rows are added as positives. The tweet-split AUC in section 2 jumps, and the weights show why: the model is separating *tweets our pipeline rejected* from *tweets our pipeline noted*, which is a fact about our own filter, not about note quality. It would be the obvious thing to build and it would be worthless.

| # | pushes toward 'helpful' | weight | pushes away | weight |
|---|---|---|---|---|
| 1 | `c:203` | +2.055 | `w:nnn` | -5.694 |
| 2 | `c:/203` | +1.926 | `c: nn` | -2.507 |
| 3 | `c:s/203` | +1.904 | `c: nnn` | -2.352 |
| 4 | `w:this image` | +1.740 | `c:nnn` | -2.343 |
| 5 | `w:this` | +1.709 | `w:note` | -1.914 |
| 6 | `w:2026 03` | +1.610 | `c:205` | -1.853 |
| 7 | `w:not real` | +1.607 | `w:nnn the` | -1.799 |
| 8 | `w:iran` | +1.491 | `c:/205` | -1.785 |
| 9 | `w:stolen` | +1.418 | `c:s/205` | -1.720 |
| 10 | `w:snow` | +1.337 | `w:july 2026` | -1.589 |
| 11 | `w:war` | +1.331 | `c: nnn ` | -1.574 |
| 12 | `w:twitch` | +1.324 | `c:nnn ` | -1.568 |

## 7. Settings, fixed before any transfer result was seen

```json
{
  "word_tfidf": {
    "ngram_range": [
      1,
      2
    ],
    "min_df": 5,
    "max_features": 50000,
    "sublinear_tf": true,
    "strip_accents": "unicode",
    "lowercase": true
  },
  "char_tfidf": {
    "analyzer": "char_wb",
    "ngram_range": [
      3,
      5
    ],
    "min_df": 5,
    "max_features": 50000,
    "sublinear_tf": true,
    "lowercase": true
  },
  "tweet_tfidf": {
    "ngram_range": [
      1,
      2
    ],
    "min_df": 5,
    "max_features": 30000,
    "sublinear_tf": true,
    "strip_accents": "unicode",
    "lowercase": true
  },
  "logistic": {
    "C": 1.0,
    "penalty": "l2",
    "max_iter": 2000,
    "solver": "liblinear"
  },
  "lsa": {
    "n_components": 200,
    "random_state": 0,
    "logistic_C": 0.1
  },
  "top_domains": 30,
  "group_kfold": 5,
  "time_split_quantile": 0.75,
  "bootstrap_draws": 2000,
  "bootstrap_seed": 0,
  "clip": [
    0.001,
    0.999
  ],
  "platt": {
    "min_n": 300,
    "min_pos": 15,
    "C": 10000.0
  }
}
```

| where a leak could have entered | what stops it |
|---|---|
| Several notes share a tweet; a random split puts near-duplicates on both sides | GroupKFold on a union-find group over tweet_id and an md5 of the note text |
| Vectorizer vocabulary / IDF / scaler / top-domain list fitted on all rows | every transform is fitted inside the fold, on training rows only |
| The corpus contains notes on the very tweets we are scoring | the transfer pool drops all 2,190 of our window tweets before fitting (3,244 census rows removed) |
| Our own notes appearing in the corpus | checked: 0 of our 8,830 note ids occur in competing_notes |
| Corpus notes written or rated after our note was submitted | the walk-forward model only sees corpus notes created before D minus 7 days |
| Recalibrating on the notes we then score | Platt fitted only on our notes submitted before D minus 7 days (walk-forward) or before 2026-09-01 (section 3c) |
| Tuning hyperparameters against our notes' outcomes | all settings above fixed before the first transfer run; all seven model configurations reported |
| Comparing on a different note set than the prior baselines | the 977 note ids and their labels are taken from predictions.parquet and asserted equal |

## 8. POST-HOC diagnostics (added after reading the weight table)

Not pre-registered. Written because two things in section 5c needed a test rather than a paragraph. Report them as post-hoc, because that is what they are.

### 8a. What `w:nnn` is, and why it matters

"NNN" is contributor shorthand for *no note needed*. It is the largest negative weight in the model, and it is real signal — but it separates a kind of note our bot never writes. Composition of the census slice by X's own `classification`:

| classification | n | H | H rate [Wilson 95%] | share opening with "NNN" |
|---|---|---|---|---|
| `MISINFORMED_OR_POTENTIALLY_MISLEADING` | 11631 | 2032 | 17.5% [16.8%, 18.2%] | 0.3% |
| `NOT_MISLEADING` | 2120 | 0 | 0.0% [0.0%, 0.2%] | 42.2% |

966 census notes contain the token. **Every note we write is a MISINFORMED_OR_POTENTIALLY_MISLEADING correction**, so the diagnostic below refits on that class alone — the population our own notes actually belong to.

### 8b. What survives each removal

All four are the same model class and the same fixed hyperparameters; only the training text or the training rows change. `transfer AUC` is on the identical 977 notes.

| variant | corpus n | positives | AUC tweet split | AUC time split | transfer pool n | transfer AUC on our 977 |
|---|---|---|---|---|---|---|
| pre-registered primary (all classifications, digits kept) | 12938 | 2032 | 0.649 | 0.621 | 9985 | **0.598** |
| post-hoc A: MISLEADING class only | 11075 | 2032 | 0.581 | 0.558 | 8516 | **0.596** |
| post-hoc B: digits masked to `#` | 12938 | 2032 | 0.646 | 0.620 | 9985 | **0.604** |
| post-hoc C: MISLEADING only AND digits masked | 11075 | 2032 | 0.588 | 0.556 | 8516 | **0.602** |

---

# PART B — Predicting at fetch time whether another author will note the post

## B1. The unit, the label and what it can and cannot see

- **Unit:** one tweet we noted. 2046 matured window notes (submitted 2026-08-07 to 2026-09-12, one note per tweet), 226 rated Helpful, 61 Not Helpful.
- **Label (primary, `earlier`):** at least one other author's note on the tweet with `created_at_millis` **before our submit time**. Positive on **1380** of 2046 (67.4%).
- **Label (secondary, `within48h`):** at least one such note created before our submit time plus 48 h. Positive on **1663** (81.3%).
- **Dump-lag cutoff.** `competing_notes` is refreshed from X's daily dump, which is about 48 h late. The pull ran 2026-09-19 03:55 UTC and the newest note here was submitted 2026-09-12, so the latest moment either label depends on (2026-09-14) is more than 5 days before the pull. No label is truncated by the lag.
- **Is a zero a real zero?** A tweet gets no `competing_notes` row either because nobody else noted it or because *our* note never reached the dump (the rows are keyed off our own note appearing there). Checked against `public_data_snapshots`: **2041 of 2046** (99.8%) of our notes are in the dump, so the censoring is 0.2% of rows, not a material share of the zeros.
- **Selection to state plainly.** These are tweets our pipeline *chose to note*. The model would be used at fetch time on tweets it has not yet chosen. We cannot observe the label on rejected tweets, because for those the dump walk keeps only competitors that ended up rated helpful (stage G). So this model is trained on the post-filter population and its numbers should be read as 'among tweets we would note', not 'among all tweets'.
- **Feature source.** `feed_tweets` at first sight, joined for 1976 of 2046 (96.6%); the 70 misses get `feed_missing=1` and median imputation. `note_request_suggestions` present on 1357 tweets, `suggested_source_links_with_counts` on 717. Both are frozen at first sight and are live-available.

### B1a. The effect that makes this worth predicting (our sample, recomputed)

| earlier note on the tweet | n | H | NH | H rate [95%] | NH rate [95%] |
|---|---|---|---|---|---|
| yes | 1380 | 169 | 18 | 12.2% [10.6%, 14.1%] | 1.3% [0.8%, 2.1%] |
| no (we were first) | 666 | 57 | 43 | 8.6% [6.7%, 10.9%] | 6.5% [4.8%, 8.6%] |

- Not-Helpful rate ratio, first vs not-first: **4.9x**. That is the prize: if the score is any good, it tells us at fetch time which posts we are about to be first on.

## B2. Models, split temporally (fit on August, test on September)

- Train: **1519** notes submitted 2026-08-07 to 2026-08-31 (1006 positive, 66.2%). Test: **527** submitted 2026-09-01 onward (374 positive, 71.0%). No random split is used anywhere. Every transform is fitted on the August rows only.

### Target `y_earlier`

| model | Brier | log loss | AUC | mean predicted | observed |
|---|---|---|---|---|---|
| `B_base` | 0.2083 | 0.6076 | 0.500 | 0.662 | 0.710 |
| `B_struct` | 0.2032 | 0.5913 | 0.620 | 0.693 | 0.710 |
| `B_struct_ctx` | 0.2070 | 0.6007 | 0.617 | 0.683 | 0.710 |
| `B_struct_text` | 0.2074 | 0.5998 | 0.627 | 0.679 | 0.710 |
| `B_gbm` | 0.1974 | 0.5780 | 0.669 | 0.694 | 0.710 |

### Target `y_within48h`

| model | Brier | log loss | AUC | mean predicted | observed |
|---|---|---|---|---|---|
| `B_base` | 0.1490 | 0.4748 | 0.500 | 0.811 | 0.818 |
| `B_struct` | 0.1482 | 0.4708 | 0.594 | 0.835 | 0.818 |
| `B_struct_ctx` | 0.1506 | 0.4746 | 0.609 | 0.830 | 0.818 |
| `B_struct_text` | 0.1529 | 0.4822 | 0.603 | 0.831 | 0.818 |
| `B_gbm` | 0.1505 | 0.4757 | 0.621 | 0.844 | 0.818 |

Model definitions, fixed before any result was seen:

- `B_base` — the August base rate, a constant.
- `B_struct` — L2 logistic (C=1) on 27 fetch-time numeric features: `age_h`, `log_impr`, `log_vel`, `log_followers`, `log_tweets`, `tier`, `has_video`, `has_photo`, `media_count`, `is_reply`, `is_quote`, `n_nrs`, `has_nrs`, `n_ssl`, `ssl_count`, `has_ssl`, `n_ctx`, `lang_en`, `txt_len`, `n_urls_tw`, `n_hash`, `n_ment`, `like_ratio`, `reply_ratio`, `quote_ratio`, `rt_ratio`, `feed_missing`.
- `B_struct_ctx` — plus the top-20 X context-annotation domain flags, chosen on the training rows only.
- `B_struct_text` — **PRIMARY**: plus a word(1,2) TF-IDF of the tweet text.
- `B_gbm` — gradient boosting on the numeric block alone (unscaled), as a nonlinearity check.

### B2a. Calibration of `B_struct_text` on the September test set

| decile | n | mean predicted | observed [Wilson 95%] |
|---|---|---|---|
| 1 | 53 | 0.318 | 0.547 [0.415, 0.673] |
| 2 | 53 | 0.455 | 0.642 [0.507, 0.757] |
| 3 | 52 | 0.561 | 0.635 [0.499, 0.752] |
| 4 | 53 | 0.623 | 0.679 [0.545, 0.789] |
| 5 | 53 | 0.672 | 0.717 [0.584, 0.820] |
| 6 | 52 | 0.727 | 0.712 [0.577, 0.817] |
| 7 | 53 | 0.776 | 0.736 [0.604, 0.836] |
| 8 | 52 | 0.826 | 0.673 [0.538, 0.785] |
| 9 | 53 | 0.877 | 0.811 [0.686, 0.894] |
| 10 | 53 | 0.952 | 0.943 [0.846, 0.981] |

- Calibration slope 0.50, intercept +0.49 (1 and 0 would be perfect). Mean predicted 0.679 against observed 0.710.

Standardised logistic weights of `B_struct` (positive = more likely someone else has already noted it):

| feature | weight | feature | weight |
|---|---|---|---|
| `n_nrs` | +0.360 | `feed_missing` | -0.435 |
| `has_photo` | +0.338 | `like_ratio` | -0.354 |
| `ssl_count` | +0.254 | `log_followers` | -0.310 |
| `log_impr` | +0.206 | `log_vel` | -0.308 |
| `has_video` | +0.182 | `age_h` | -0.264 |
| `n_hash` | +0.169 | `n_urls_tw` | -0.223 |
| `is_reply` | +0.081 | `tier` | -0.210 |
| `reply_ratio` | +0.076 | `lang_en` | -0.208 |
| `log_tweets` | +0.063 | `txt_len` | -0.166 |
| `n_ctx` | +0.050 | `is_quote` | -0.045 |

## B3. Walk-forward score, then the payoff

- `B_struct_text` refitted for every UTC submit day D on notes submitted before **D minus 3 days** (the dump lag, so the label was knowable). 35 refit days; 455 notes on early days fall back to the running base rate.

### B3a. Does the fetch-time competition score rank our own outcomes?

Scored on the identical **977** notes of the prior backtest (90 H, 27 NH, 117 rated). Labels are taken from `predictions.parquet` so the comparison is exact; re-pulling `notes` 9 h later moved 1 of them, which is a reminder that a Community Note's status is not permanent.

| target | AUC of `compete` | AUC of realised `has_earlier` (48 h late) | AUC of `prior_30d` |
|---|---|---|---|
| H | 0.574 | 0.547 | 0.534 |
| NH | 0.378 | 0.290 | 0.468 |
| rated at all | 0.527 | 0.484 | 0.500 |

An AUC below 0.5 against NOT-helpful is the *right* sign: a post we are unlikely to be first on is a post we are unlikely to be marked Not Helpful on. Read as a predictor of avoiding NH it is AUC 0.622. The score also beats the **realised** `has_earlier` flag on H ranking, which is notable because that flag is the ground truth it is trying to guess — but it arrives 48 h late and cannot be used.

The whole case in one table — quintiles of the fetch-time score, on the 977:

| quintile of `compete` (fetch time) | n | mean score | our H rate | our NH rate | realised: earlier note present |
|---|---|---|---|---|---|
| 1 | 196 | 0.384 | 6.6% | 3.6% [1.7%, 7.2%] | 50.5% |
| 2 | 195 | 0.607 | 7.7% | 3.6% [1.7%, 7.2%] | 65.6% |
| 3 | 195 | 0.729 | 7.7% | 4.1% [2.1%, 7.9%] | 72.3% |
| 4 | 195 | 0.829 | 10.3% | 2.1% [0.8%, 5.2%] | 74.9% |
| 5 | 196 | 0.934 | 13.8% | 0.5% [0.1%, 2.8%] | 88.8% |

Out of sample, from features frozen at first sight. The H column and the realised-earlier column rise monotonically across all five quintiles; the NH column falls from 3.6% to 0.5% but is **not** monotone — it bumps up at the middle quintile (4.1%). Bottom quintile against top is 7.0x on 7 and 1 Not-Helpful events respectively, out of 27 in the whole sample — the ordering is the finding, the ratio is noise.

| forecaster | Brier | log loss | AUC | Brier diff vs prior_30d [95%] | excludes 0? |
|---|---|---|---|---|---|
| `prior_30d (H)` | 0.08450 | 0.3118 | 0.534 | ref | - |
| `compete_platt (H)` | 0.08540 | 0.3146 | 0.577 | +0.00090 [-0.00046, +0.00219] | no |
| `prior_30d (NH)` | 0.02693 | 0.1273 | 0.468 | ref | - |
| `compete_platt (NH)` | 0.02677 | 0.1234 | 0.638 | -0.00016 [-0.00039, +0.00006] | no |

2000-draw note-level bootstrap, percentile interval, same resamples for every row. The raw `compete` score is a probability that *someone else noted the post*, not a probability that our note is helpful, so only the Platt-mapped rows belong in a Brier column; the AUC row above is the honest read of its ranking power.

### B3b. Can it stand in for `has_earlier`, which is 48 h late live?

Fit on our matured August notes (1519), tested on September (507).

**Target H** (44 positives in the test set)

| model | Brier | log loss | AUC |
|---|---|---|---|
| `stable4_no_earlier` | 0.08179 | 0.3319 | 0.550 |
| `stable4 (has_earlier, 48h late)` | 0.08137 | 0.3258 | 0.566 |
| `stable4_no_earlier + compete` | 0.08171 | 0.3250 | 0.551 |

**Target NH** (19 positives in the test set)

| model | Brier | log loss | AUC |
|---|---|---|---|
| `stable4_no_earlier` | 0.03685 | 0.1776 | 0.465 |
| `stable4 (has_earlier, 48h late)` | 0.03577 | 0.1568 | 0.681 |
| `stable4_no_earlier + compete` | 0.03672 | 0.1748 | 0.545 |


## B4. Settings, fixed before any result was seen

```json
{
  "logistic": {
    "C": 1.0,
    "max_iter": 2000
  },
  "gbm": {
    "n_estimators": 200,
    "max_depth": 3,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "min_samples_leaf": 20,
    "random_state": 0
  },
  "text_tfidf": {
    "ngram_range": [
      1,
      2
    ],
    "min_df": 5,
    "max_features": 30000,
    "sublinear_tf": true,
    "strip_accents": "unicode",
    "lowercase": true
  },
  "top_context_domains": 20,
  "label_lag_days": 3,
  "horizon_hours_for_L2": 48,
  "primary_model": "B_struct_text",
  "primary_label": "earlier"
}
```
