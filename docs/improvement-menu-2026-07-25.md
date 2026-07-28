# CN improvements — Nathan's three ideas, checked against data (2026-07-25)

All numbers pulled fresh this session (`tmp/nathan_tags_analysis.ts`, `tmp/posting_order_analysis.ts`, `tmp/breaking_news_and_surplus.ts`, `tmp/cost_speed_checks.ts`). Mark up inline (`> ⟢` = Claude's questions for you; write under them).

---

## A. What the data says

### A1. Your tags (516 annotations, 100 distinct tags; July = biggest month, 224)

Top tags since Jun 1, clustered:

| Cluster | Tags (count since Jun 1) | Outcome where matched |
|---|---|---|
| **Relevance/engagement** ≈ 66 | did not engage with the argument (30), pedantic correction (23), didn't convince raters (13) | did-not-engage: 0H/29NH lifetime; pedantic: 1H/22NH |
| **Pangram wreckage** 19 | raters didn't care it was ai generated (19) | 0H/7NH/12NMR — contained, pipeline off |
| **Research errors** ≈ 19 | error in world model (9), error in research (7), hallucinated info (3) | error-in-research 0H/9NH |
| **Breaking news** ≈ 16 | breaking news (7), missing the latest news (7 lifetime), no date info, relies on old/outdated sources | breaking-news: 0H/6NH |
| **Source trust** ≈ 15 | sources unlikely to convince (6), source not found (5), low quality source, "biased" sources, right-wing fact check w/ sensitive raters | mostly NMR/NH, 0H |
| **Overconfidence** 5 | too confident (5) | 0H/5NH |

So: your three ideas each have a real tag cluster behind them, but **relevance/engagement is still ~4× bigger than either** — the materiality judge (docs/relevance-layer-design.md) remains the largest single fix nobody has built.

### A2. Posting order (your Q: "what's the correlation?") — YES, strong

Order exists: `submitCandidates` sorts all candidates by **X eval score desc** (+ misinfo reserve #280, freshness decay). Within-batch position vs outcome, 4,021 mature (>10d) notes since Mar 1:

| Submit position in batch | n | H% of rated | net (h−u)/n |
|---|---|---|---|
| 1 | 1,753 | **82%** | +9.8% |
| 2–3 | 1,666 | 75% | +6.4% |
| 4–6 | 512 | **54%** | +1.0% |
| 7–10 | 72 | 33% | −1.4% |

Clean monotone gradient (matches the eval calibration curve — top bin 12H/0U). The marginal note is *much* worse than the best note. Caveat: deep positions only exist on high-volume days, so position partly confounds with era — but direction survives a since-Jun-1 restriction (r = −0.14, rank vs helpful).

**Your instinct is right**: with the cap quality-bound (HR_100 → WL_L → cap, ≈ +3 cap per +1pp hit rate), filling slots with position-1-quality instead of position-3+-quality notes is a direct cap lever.

**But the pool is thin**: written-but-unsubmitted surplus (`outcome=candidate`) is only 7–17/day vs 13–25 submitted — ~1.3–1.7× the cap. Real selection needs ~2–4×.

### A3. Breaking news — the dead scorer had real signal

The retired rubric (killed for cost 2026-06-01, PR #154) included `breaking_news_risk`. On 239 rated notes Mar–Jun: **AUC 0.69 predicting helpful** (mean score H=0.73 vs NH=0.53; higher = safer) — as good as the best retired scorer (`helpfulness` 0.71 on the same sample). Timing corroborates:

| Submit lag since tweet | n | rated-at-all | H% of rated |
|---|---|---|---|
| <3h | 1,005 | 14.4% | 74% |
| 3–6h | 1,034 | **17.2%** | 76% |
| 6–12h | 862 | 14.4% | **79%** |
| 12–24h | 815 | 9.6% | 77% |
| 24–48h | 267 | 6.7% | 61% |
| 48h+ | 43 | 4.7% | — |

Two reads: (a) **<3h is NOT the best band** — slightly worse quality than 3–12h, consistent with "facts still moving"; (b) **after 24h notes are nearly pointless** (6.7% rated, +1.5% net) — a stale-cutoff is free money.

### A4. Sources — infra already exists for the misinfo case

PR #283 (merged Jul 19) steers the **misinfo** writer to in-group/primary sources via a curated reference doc + soft prompt rule, guarded by `if (monitoring)`. The regular ~20/day flow has **no** audience-awareness: writer cites whatever the search surfaced (historically CNN/PolitiFact-heavy). Your tag cluster says raters notice.

### A5. Economics

Fully-loaded ≈ **$1.05/written note** ($431 over 14d, 410 written; ~$31/day). Marginal: $0.15 write + ~$0.90 of upstream processing. Doubling the candidate pool ≈ **+$30/day**.

---

## B. Proposed builds + A/B tests

**Power warning first:** ~13% of submitted notes ever get rated → ~2–3 rated notes/day at current cap. Arm-vs-arm A/Bs on cn_status take **months** to read. So the menu leans on (1) **shadow scorers benchmarked against your tags** (fast, zero risk), (2) **rated-at-all** as the fast metric (~2 weeks), (3) pre-registered curves — not naive arm comparisons.

### The menu at a glance (named + quantified, 2026-07-27)

**Baseline for the percentages:** current regime ≈ 22 submits/day → **~50 Helpful / ~25 Not-Helpful per month** (recent windows run ~8%H / 4%NH of written; lifetime mature is 10.3%H / 3.2%NH). Effects below are **at fixed cap**; the cap feedback (each −1pp NH or +1pp H moves HR_100 → ~+3 cap/day) then *multiplies* Helpful volume on top, 2–8 weeks later.

| # | Name | Δ Not-Helpful | Δ Helpful (fixed cap) | Derivation anchor | Confidence |
|---|---|---|---|---|---|
| T2 | **Breaking-news gate** (date fix + true-at-post check) | **−20–30%** (−5–8/mo) | ~0 directly (cluster is 0H — gate costs nothing) | breaking-cluster ≈ 25–33% of recent NH (9–10 of ~30–38 since Jun); detector catches ~75% | High |
| T3 | **Bigger candidate pool** (generate 2–3× cap, submit best) | −15–30% | +5–10% | deeper pool → more submissions in the top eval bin (12H/0U historically vs 76% H-of-rated average); weakest derivation on the menu — best-of-bigger-pool is extrapolated, not measured | Med |
| T5 | **Stale-tweet cutoff** (no notes on tweets >24h old) | ~0 | **+4–5%** (+2/mo) | 7.7% of submits are >24h-old (4.5%H/2.6%NH) → reallocated to fresh-average (10.3%H/3.2%NH) | High |
| T1 | **Audience-trusted sources** (primary/in-group sourcing for all notes) | −5–15% | +0–5% | source-trust cluster ≈ 10–15% of NH; possible NMR→H conversion unquantified | Low-Med |
| T4 | **Materiality judge** (does the note engage the real claim?) | **−25–35%** | **−2–5%** (false positives) | engage/pedantic/convince cluster = 56 of 130 lifetime NH (~43%); judge catches ~60% at ~5% FP on H notes | Med |

**Reading it:** the breaking-news gate (T2) and materiality judge (T4) are the NH-cutters (same league, but T2 is a day's work at High confidence vs T4's research loop); the stale cutoff (T5) and bigger pool (T3) are the H-gainers; audience-trusted sources (T1) is the flyer. **Not additive** — T2/T4/T1 draw from the same NH pool (sum of all three ≈ −40–55% NH, not −70%). Stacked realistic outcome if T2+T5+T3 land and hold: **NH −30–45%, H +10–15% at fixed cap**, then the cap feedback takes total Helpful volume up **+30–60%** (cap ~25 → ~35–45) over 4–8 weeks. All ±50% ranges; every gate gets the §C counterfactual backtest before going live — the discipline matters more than the point estimates. (Cap-slope basis: +3/day per +1pp net HR_100, current 5–10% WL_L tier; DN_30×5 ≈ 60/day becomes the next ceiling.)

### T3 Bigger candidate pool — generate 2–3× the cap, submit only the best *(idea 2)*
Raise per-run processing so the candidate pool ≈ 2–3× cap; submit strictly best-first; **discard candidates >24h old** (A3's dead zone). Not a weighted A/B (the cap is shared across arms) — run as before/after with pre-registered metrics: mean eval of submitted notes, HR_100 trend, spend/day.
Cost ≈ +$30/day. Direct cap flywheel: better top-k → HR_100 ↑ → cap ↑ → more slots.
> ⟢ **Q1** — approve the +$30/day (~$900/mo) spend at 2×? Or start at 1.5× (+$15/day)?

### T2 Breaking-news gate — date fix + true-at-post check *(idea 3 — resolved in chat 2026-07-27)*
Audited all 21 breaking-cluster tagged notes (15NH/0H where rated): the cluster splits into three shapes, so T2 is three pieces, not one scorer.
**Step 0 (two-line fix, ship first):** searcher + writer prompts currently pass **no current date** (verified on origin/main; Nathan's 2026-07-01 tag comment, still true). Inject "today is {date}; the tweet was posted {tweet_time}". Feeds everything below.
**Core check (Nathan's framing, sharpened 2026-07-31 — the time-travel test):** *"If this note had been attached the moment the tweet was posted, would the correction have been accurate and fair then?"* Tests the **note**, not the tweet — if the correction is only true because facts moved since posting ("true when posted but isn't now": Ronaldo scored again, match finished differently), it fails → abstain. If the correction was already true at post time (video always from 2019, stat always fabricated), it passes → note. This subsumes the earlier "was the claim true at post time" phrasing and directly simulates what raters punish: correcting someone for not knowing the future.
**Sibling rule:** in a fast-moving window, never write a note whose evidence is *absence of reports* ("has not died", "no reports of X", "has not been transferred") — the ~4–5 cases where the bot's search lagged the news. Truth-at-post can't catch these (the tweet was ahead of our search, not behind it).
**Stale-research shape** (~6–8 of 21) is addressed by step 0 + date-aware search ("prefer sources published after {tweet_time}").
Ship as: prompt/date fix → shadow scorer logging all three judgments → **counterfactual backtest** (which past notes would it have stopped → recompute HR_100 → predicted cap via the WL formula) → gate only if backtest holds. Ex-ante estimate: cluster ≈ 1–2 of ~4 NH in the current 100-note window → +1–2pp HR_100 → **+3–6 cap/day (+15–30%)** at the measured ~+3-cap-per-pp slope, plus NH_5-cliff tail-risk removal. Tag evidence says the gate costs ~zero helpful notes (0H in cluster).
~~Q2 delay-and-recheck vs abstain~~ → superseded: abstain on true-at-post + negative-assertion shapes; delay only helps the stale-research shape, which the date fix addresses more cheaply.

### T1 Audience-trusted sources — primary/in-group sourcing for ALL notes *(idea 1)*
Generalize #283 beyond the `if (monitoring)` guard: search prompt gains "also look for primary sources (.gov, court records, the subject's own statements) and outlets the post's audience trusts"; writer gets a generic soft rule (inferring audience from the post — no curated doc for the general case, that's the main difference from #283).
A/B: `audience_sourcing` on/off at 30/70. Metrics: cited-domain mix shift (log it), rated-at-all, your source-cluster tag rate per arm.
> ⟢ **Q3** — v1 = pure prompt change, or also maintain a small static outlet-by-audience map (Fox/WSJ/NYPost for right-coded posts, etc.)? Prompt-only is cleaner; the map is more controllable.

### T4 Materiality judge — does the note engage the real claim? *(the biggest cluster, not in your three)*
Still the #1 failure (66 tags since Jun, ~0% helpful when tagged). Shadow scorer: "does the note engage the tweet's load-bearing claim, and would the correction change a reader's takeaway?" Benchmark against your did-not-engage/pedantic tags (the 100%-predictive oracle). This is `relevance-layer-design.md`, still unbuilt.

### T5 Stale-tweet cutoff — no notes on tweets >24h old *(trivial, data-backed)*
Hard-drop candidates whose tweet is >24h old at submit time. 310 such notes since Mar: 6.7% rated, +1.5% net — near-pure waste of cap slots + streak risk. Config-level change; could be a 50/50 A/B but I'd just ship it.

## C. Analyses (no build)
- **Impact predictor (general tool, from the T2 thread):** for any proposed gate/filter, run it as a shadow scorer over the historical corpus → count which past notes it would have stopped → recompute HR_100/HR_14d counterfactually → the WL formula converts that to a predicted cap change. Predict-before-build for every change in this space.
- **Tag-context join**: for every tagged note, attach eval score + batch position + submit lag → "would T3/T5 have prevented this failure?" (backtest before building).
- Monthly pre-registered eval-curve refresh (drift check).
- Re-run the order gradient era-controlled once the cap recovers past ~40.

**My recommended order: T3 → T2-stage-1 → T5 → T1 → T4.** T5 could ship today; T2 stage 1 is a day; T3 is the real cap lever; T4 is biggest-prize-hardest-build.

> ⟢ **Q4** — which do you greenlight? (Each ships as its own reviewable PR.)
