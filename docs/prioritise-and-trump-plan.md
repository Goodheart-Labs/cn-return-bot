# Prioritisation + Trump readiness — facts to work through

**Two questions:** (1) Is careful prioritisation worth building, or is rough fine? (2) How do we open up Trump correction notes — including knowing which are likely to be rated Helpful?

Mark up inline: `> ⟢` = Claude. Add your own under any fact. VERBs: CUT / CHECK / WEAK / Q / STRONG. Numbers cite their source so we can re-derive.

---

## A. Is careful prioritisation worth it? (supply vs cap)

- **A1.** We already post best-first. `submitCandidates` sorts candidates by `evaluationScore` descending before submitting (`submitCandidates.ts:37`). So "rank the queue by our best live scorer" is **already shipped** — not a thing to build.
- Oh we figure out how many slots we have then gather some number? We do?
  > ⟢ **ANSWER** (Claude) — **Yes, exactly** (`computeMaxPosts.ts`). It reads `remainingSlots = writing_limit − submitted_24h`, then because ~89% of processed tweets get rejected it divides by the **conversion rate** (candidates ÷ tweets processed, ~11%) and ×1.25 safety → that's `maxPosts`, how many tweets to gather (capped at 20). So we gather a surplus *sized to yield ≈ the slots we have*. **That's the crux of A4:** the gather is tuned to produce ≈slots candidates with only a 1.25× overshoot — so there's barely a surplus to rank. If we *wanted* ranking to bite, we'd raise that multiplier to deliberately over-gather and cherry-pick the best. **One caveat:** this rationing only runs when we hit the cap recently (≤12h); otherwise it skips straight to processing the full 20/run.
- **A2.** Base rates (DB, last 8 days, `tmp/supply_vs_cap.ts`): ~**220 tweets processed/day**, ~**19 submitted/day**, ~**89% rejected** at the note-needed prefilter / eval gate.
- **A3.** Surplus we throw away for lack of cap is **tiny**: only **~3.6 notes/day** hit `daily_limit_reached` (29 over 8 days). Plus ~5/day sit in `candidate` limbo. So the pool of note-worthy candidates we *can't* post is a handful/day, not a backlog.
- **A4.** Put A1+A3 together: the surplus available to re-rank is ~5–8/day **and it's already eval-sorted**. A smarter ranking reorders ~half a dozen notes a day. **Low ceiling.**
- **A5.** The real ceiling is the **cap itself** (~19–21/day now) and it moves **super-linearly** with hit rate (the 700→3000→6000 slope). Raising hit rate unlocks far more than any reordering.
- **A6.** The other real lever is **generation yield** — we reject 89% at the gate. Finding *more genuinely note-worthy tweets* (feed/selection) raises output more than ordering the few that already clear.
  > ⟢ **Q1** (Claude) — My read: **rough is fine, don't build careful candidate-ranking now.** It's already eval-sorted and the surplus is ~6/day. Spend the effort on hit-rate (raises the cap) and Trump instead. Agree, or do you want a ranking pass anyway?

---

## B. What makes a note likely to be rated Helpful

- **B1.** Only **one live scorer has signal**: `evaluation` (AUC **0.67**) — and it *is* X's own eval gate, returned free per note. `source_verification` (0.50) = noise. (Verified this session; AUCs from the Jun-25 Mann-Whitney work.)
- I worry the trump thing is gonna get gated by this a lot
  > ⟢ **CONFIRMED — worry is real** (Claude) — Trump notes skip the note-needed prefilter (MonitoringContext) but **still pass through the X eval gate** (`processTweet.ts:235`, threshold `eval_submit_threshold ?? 0`). So X's own model can reject them as `low_evaluation_score`. Whether it *does* reject a lot is untested — see the gate experiment below (Q5).
- **B2.** The two **best** predictors — `helpfulness` (0.715), `note_not_needed` (0.700) — were **retired 2026-06-01** (PR #154) for cost (~cents/note). Never replaced as ranking signals. So our best quality signals are switched off.
  > ⟢ **RESOLVED — don't re-add (2026-07-18)** (Claude) — Considered putting `helpfulness` back now budget is looser. Decided against: (1) 0.715 is *modest* (≈ the free live eval 0.67 — a 0.045 gap measured once, maybe not age-controlled); (2) it's plausibly **redundant** with eval (two LLM judges reading the same note agree); (3) the version that *would* pay off — spend budget to over-generate a big pool then rank hard — is **too complex** for the payoff (it only lifts the quality of ~20 notes/day). **Keep the simple live eval gate.** Effort goes to hit-rate + Trump, not a richer scorer. (The marginal-over-eval test is parked, not run.)
- **B3.** Your **hand-tags are ~100% predictive** ("pedantic" 0/16 helpful, "did not engage" 0/14). The failure mode is **relevance / materiality, not correctness** — notes die by being pedantic or not engaging the actual claim.
- **B4.** So a "good note" ≈ **engages the disputed claim materially** (not a pedantic aside), **cites a solid source**, and **lands fast** (75% of Helpful notes post <12h — stats, F13, untested here).
  > ⟢ **Q2** (Claude) — For Trump specifically, B3 is the whole game: a note that nitpicks a number dies; a note that squarely rebuts "China stole 220M voter files" with a primary source is the shape that rates Helpful. Does that match your instinct?

---

## C. Which Trump tweets are most likely to be noted (and rated Helpful)

- **C1.** The pool: **29,412 captured tweets** in `feed_tweets` (PR #270, hourly dump). Jim's runner filters ~29k → **~1.3k keyword matches** → LLM selection → review dashboard, ranked by **recency + impressions**.
- **C2.** The topic fact-checks the **5 specific claims** from Trump's July-16 primetime speech (China acquired 220M US voter files; deep-state cover-up; China manufactured Biden ballots; etc.). Ground truth = `documents/trump_election_security.md`.
- **C3.** Which tweets are *likely notable* (hypotheses to test, not yet data): (a) states a **checkable claim as fact** (not opinion/vibes); (b) **high impressions**; (c) posted **fast** after the speech; (d) the claim maps to something the ground-truth doc **debunks with a citable primary source**.
- **C4.** ⚠️ The **big unknown**: political notes need **cross-tribe agreement** to reach CRH. Our normal helpful-rate (~18% resolve at all) may be **worse** on partisan claims — the note can be correct and still never clear because one side down-rates it. We have **no prior data** on this in our set; Trump notes are the first real test.
  > ⟢ **Q3** (Claude) — This (C4) is the fact that decides whether Trump notes are worth the slots at all. Two ways to read it: either (i) high-impression, clearly-false claims are exactly where CN's bridging algorithm *does* find cross-tribe agreement (so they rate well), or (ii) they're the most tribal and never clear. Do you have a prior? I lean (i) for *factual* claims (voter-file counts) and (ii) for *framing* claims (cover-up narrative).

- **C5. The gate question (Nathan's worry, confirmed above).** Trump notes must clear the X eval gate, which may over-reject political content. Options: **(a)** keep the X gate as-is; **(b)** lower the eval threshold for the misinfo topic only; **(c)** OR-gate — pass if X-eval *or* helpfulness clears (max coverage); **(d)** split A/B — half the Trump notes gated by X, half by helpfulness, then compare CRH to *learn* which gate is better. Helpfulness re-added **scoped to the misinfo pass only** (≤15/run) is cheap, unlike the global re-add we rejected in B2.
- **C6. Cheapest first step:** dry-run the misinfo pass on Jim's selected Trump tweets → generate notes → **log eval scores, submit nothing**. Shows X's real reject-rate on Trump content *before* we design any gate. If X passes most, the worry evaporates and we skip the split.
- **C7. ✅ SHIPPED (PR #280, merged 2026-07-19).** Bounded submit-priority reserve: up to 2/24h (~10%) of the best misinfo notes pushed ahead of the eval-sort. Reversible (`MISINFO_RESERVE_24H=0`), fail-soft, eval floor permissive for v1 (`-Infinity`). Watch task filed. Prioritisation model (Nathan, 2026-07-18).** Rank by **impact**, not just P(helpful): a note's worth ≈ P(helpful) × views, and a Trump correction ≈ **10× the views** of a standard note → worth boosting up the submit queue. **But cap the boost at ~10% of allocation** (~2 of ~20/day): some Trump notes jump the ranking, not all. Rationale = *portfolio risk control* — Trump is high-value but high-variance (may rate poorly, C4), and over-posting low-rating notes **dilutes hit rate → lowers the cap** (anti-spam lever), hurting everything. So bound the high-risk bucket to ~10%, keep 90% on the proven flow. Mechanically = the missing **submit-priority** (D2): pull top ~10%-of-cap Trump candidates to the front before the eval sort.
- **C8. COUPLING.** The C7 reserve only *fills* if Trump notes clear the eval **gate** (C5) to become candidates. If the gate rejects them, the reserved slots sit empty. So **C6 dry-run first** → tells us if there are Trump candidates to boost *and* whether the gate needs loosening. Gate + priority are one problem.
  > ⟢ **Q5** (Claude) — The design fork: do you want to **learn** whether X's gate is well-calibrated for politics (→ split A/B, slow, weeks of CRH data) or just **maximise Trump coverage now** (→ lower threshold / OR-gate, ships immediately)? Pick one and it picks the build.

---

## D. Trump vs normal — how they share the budget

- **D1. ⚠️ CORRECTED.** Mechanism (re-checked `runPipeline.ts` + `submitCandidates.ts:38`): the misinfo pre-pass makes ≤15 Trump candidates, concatenated with regular into **one submit call sharing X's daily cap** — but that call **sorts by eval score descending**, so Trump has **NO submit priority** (my earlier "Trump first" was wrong; array order is overridden by the eval sort). `computeMaxPosts` (line 132, *before* the pre-passes) budgets only the regular pass and does **not** subtract the misinfo notes.
- **D1b. Trump is if anything disadvantaged:** if X's eval gate scores political notes low, Trump notes sort to the *bottom* of the combined queue and are **cut first** when the cap binds. So "prioritise Trump" needs an *explicit* mechanism — it doesn't happen for free.
- **D1c. Volume if turned on:** ≤15 Trump notes/run (`MISINFO_MAX_PROCESS`), from a **live-feed** crawl (not the 29k offline dump), all bounded by X's ~20/day shared cap. Net effect = **reallocates the ~20 daily slots**, not new volume. Possible short initial burst as the warm post-speech feed gets sighted.
- **D2.** So reserving room for Trump = **hold back the regular pass's budget AND give the misinfo arm submit priority** (else the eval sort buries it). Write-path **merged to `main` 2026-07-18 (PR #275), typecheck clean, still gated off** (`MISINFO_PIPELINE_ENABLED = false`, runPipeline.ts:104); the priority piece is *not* built.
- **D3.** The writing limit's real job = **anti-waste** (don't spray the regular pass into 403s and burn ~$1/note generations). It is *not* a quality lever.
- **D4.** Redesign shape: regular budget targets `observed_cap − trump_reserve − small_anti_403_buffer`. `trump_reserve` tunable.
  > ⟢ **Q4** (Claude) — Starting `trump_reserve`? I'd say **5 slots** while we test, then dial down. But it only bites when Trump demand exists — on a quiet Trump day the reserve just goes unused unless we let the regular pass reclaim it. Want reclaim-if-unused, or hard-hold?

---

## E. Decision + open questions

- **E1. Careful vs rough:** rough (already-shipped eval-sort) is the recommendation (A4). Confirm and we don't build ranking.
- **E2. Highest-value work instead:** hit rate → cap (A5), and generation yield (A6).
- **E3. Trump readiness gating list:** (a) ground-truth doc quality; (b) reserve mechanism (D4); (c) a way to *watch* whether Trump notes actually clear CRH (C4) before scaling.
- **E4. To verify:** do political/misinfo notes clear CRH at normal rate? (no prior data — C4.)
- **E5. Writing-limit redesign → PARKED (2026-07-18, WD5 task `1216679893102707`).** Decided the predict-the-cap redesign is *modest value* (X's rolling 24h cap is the hard ceiling regardless; it only saves ~$3.6/day waste + smooths recovery). Prod stays on the reverted observed-cap baseline. Design settled if we ever build it: full predicted (no reserve), ×1.25 over-process, log predicted-vs-actual-403; or the simpler "just re-probe every ~6h." Effort goes to Trump instead.
