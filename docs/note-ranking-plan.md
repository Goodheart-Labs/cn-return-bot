# Note ranking — order submissions by P(rated Helpful)

**Goal:** when daily quota is scarce (which is always now — cap ~9), spend each slot on the note most likely to reach *Currently Rated Helpful*. That needs a per-note score that ranks candidates by `P(CRH)`. This doc lays out the facts; mark up inline (`> ⟢` = Claude, add your own).

---

## A. What we have (data facts)

- **F1.** `pipeline_scores` = 500k rows, one row per signal per run. Columns: `score_type`, `score_value` (float), `score_label` (string, e.g. "YES"), `score_metadata` (jsonb), `pipeline_run_id`. Join to outcome via `pipeline_run_id → pipeline_runs.note_id → notes.cn_status`.
- **F2.** Label = `notes.cn_status`, but only **3 of X's 7 statuses** exist in our mirror (CRH / CRNH / NMR). Ranking target = `P(CRH)`. Note ~**82% of notes never resolve** (stay NMR forever), so "not CRH" is the honest negative class, not just CRNH.
    - So what you think we should mirror properly?
        > - **What we found:** the limit formula's `HR_14d` term excludes notes with status `minimum_ratings_not_met` — a status our mirror doesn't store. So the formula **does** need that distinction. We don't **need** to *store* it, we **derive** it. `minimum_ratings_not_met` ≈ "NMR with <10 total ratings," and we have the counts in `note_ratings_from_public_dump`. So "need the distinction" ✓ and "no mirror change" ✓ are both true — computed from counts, not a stored label. (The other 3 unused statuses — needs_your_help, firm_reject, insufficient_consensus — are rare and don't move our number.) okay but would it be easier for us to store it?
        > - **suggest** (Claude · *confidence: inferred, not verified*) — Maybe. The `updateNoteFeedback` cron already calls the X API (`fetchNotesWritten`), which *returns* the full 7-value status — so we could store it verbatim in a new column instead of collapsing to 3, and skip the count-derivation. **But** whether that's easier hinges on a fact I haven't checked: does X's API actually *emit* `minimum_ratings_not_met` for our notes, or does it collapse to 3 in practice too? (My one API pull was the wrong account and showed only 3.) **Verify before deciding:** pull `notes_written` for the real account → if the 4th status appears, storing is cleaner; if not, counts are the only path.
              - I dunno, can we know that?
                > ⟢ **suggest** (Claude · *confidence: checked — not from current logs; the fix is cheap*) — Not from what's logged today: I grepped a prod `Update Note Feedback` run and it doesn't print raw note statuses. Two ways to actually know: (a) the admitted account's API creds (same blocker as before), or (b) **add one log line** to the cron's `fetchNotesWritten` step dumping the status distribution, then read the next run (~2-line change, definitive). **My take:** this is a small question gating only *store-vs-derive neatness* — we can already compute the cap from counts either way — so I'd **park it**, not chase it now.
            - I guess the quetion here is if we should be calculating these limits internally to predict how much space we have at the top?
              > ⟢ **suggest** (Claude · *confidence: "can compute" verified ×2; "should build" = my recommendation*) — I think **yes** — this is the high-value move and the heart of the posting-strategy thread. The formula reproduces X's cap (WL≈12 now; exact 9 at 05:23), so computing it internally gives a **live headroom read** ("cap ~12, posted 9 → ~3 free") → generate-to-fill instead of discovering by 403. Caveat: it's a reconstruction validated at only 2 points, so build it as a *guide that actual submissions still correct* (compute **and** observe), not blind trust. → this is the thing to anchor `posting-strategy.md`.
          > - **The formula that predicted correctly** (validated this session): X's **AI-Note-Writer writing-limit formula** — `WL = max(5, floor(min(DN_30×5, WL_L)))`, `WL_L` piecewise on `HR_L = max(HR_100, HR_14d)`, with the `NH_5≥3→5` / `NH_10≥8→2` cliffs. Fed live data → **WL≈12 now**, and the real proof: **it reproduced X's exact 9** at the 05:23 refusal (HR_100≈3%, HR_R≈0 → 300×0.03 = 9). Inputs, all computable from what we have:
          >   - `HR_100` = (CRH−CRNH)/100 over the 100 most-recently-**written** notes — cn_status only ✓
          >   - `HR_14d` = (CRH−CRNH)/qualifying, last 14d, dropping <10-rating NMR — needs **rating counts** (the "other status" concern, resolved) ✓
          >   - `HR_R` (last 20), `DN_30`, `NH_5`, `NH_10` — cn_status + write-date ✓
          > So nothing is blocked by the 3-status mirror; the only thing beyond `cn_status` is rating *counts*, which we already pull. **Collapse →** *"Formula needs the <10-ratings distinction, which we derive from rating counts — no 7-status mirror needed. The validated predictor is the AI-writer WL formula (reproduced X's cap exactly)."*
    - Then caculate our post limit on the fly and then see if we can post more and get fewer "exceeded rate" or whateer
      > ⟢ **ANSWER** (Claude) — Yes — proven feasible this session: the formula fed live data gives **WL≈12 now** and reproduced X's **exact 9** at 05:23. So budget generation against the **computed** limit, not the stale observed floor → less under-writing AND fewer blind "exceeded" 403s. (You still need ~1 probe 403 to confirm the true ceiling — can't get to zero if you want to max out.)
      - Okay so i think we should build this. 
        > ⟢ **agreed + policy captured** (Claude) — Your rule: **move *half* the distance from where we are now up to the predicted barrier; leave the other half free.** Formally `target = submitted_24h + floor((predicted_WL − submitted_24h) / 2)`. Today: submitted ~9, predicted_WL ~12 (up to ~21 if the recent-window rate holds) → post ~10–15, leave the rest. **Why it's sound:** it's a *damped* approach to the ceiling (AIMD-flavoured) — converges without overshoot and shrugs off the prediction's noise (WL read 9 → 12 → 21 across *today* alone; half-stepping won't chase a transient spike). **Synergy:** if we only post half the headroom, it *must* be the **best-ranked half** (top P-helpful) — so this policy and the ranking work compose directly. **Resolved (Nathan):** "half" is an **adaptive knob** — start 0.5, dial toward 1.0 as the prediction earns trust. And it **must be flagged as a deliberate choice** — a clear *"we under-post on purpose to hedge prediction noise + protect hit rate; dials up as the predictor proves out"* comment at the code site **and** spec'd in a findable place — so it never reads as a bug. **Resolved (Nathan):** no new doc (we over-write) — findable home = the code comment above + one line on the CN logseq page.
    - Like actually look but what do we do currently?
      > ⟢ **ANSWER** (Claude) — Reactive, not predictive: bot trusts the **last observed** limit (9), rations `remaining = limit − submitted_24h`, skips at 0, and re-probes only after a **12h staleness window** (`computeMaxPosts.ts`). The formula-based `computeWritingLimit` **exists but is disabled**. So today we *discover* the cap by hitting it; your Q2 is to *compute* it ahead — a real, buildable upgrade.
      > **Scope flag:** consider a sibling `posting-strategy.md` for the how-many question so this doc stays about ranking. They compose but are separable.
- **F3. Maturity confound (bitten repeatedly this session):** recent notes are unrated → any scorer evaluation MUST use notes >21d old (or age-matched cohorts). Raw rates flatter whatever's older.
- **F4.** ~4,629 submitted notes lifetime; the `evaluation` score is logged on every current run.

> ⟢ **CHECK** (Claude) — I could not re-derive AUCs on fresh data this session: `pipeline_scores` has no index for a `score_type` scan, so every query 500s. Real blocker — we either add an index, materialize a `note_id × score_type` view, or pull via the stats-dashboard join. Flagging because all AUCs below are from the *prior* Jun-25 Mann-Whitney work, not re-verified today.

## B. Which signals predict Helpful, ranked (prior work, AUC vs cn_status)

- **F5.** `helpfulness` — **AUC 0.715** (best). ‼ **RETIRED 2026-06-01** (per-note scorer stopped).
    - Can we figure out why we retired it.
      > ⟢ **ANSWER** (Claude) — **PR #154 "Remove LLM note-scoring (keep X eval gate + pipeline_scores table)", Jim, 2026-05-29** (live ~06-01). Title gives no reason, but it sits mid **cost-cutting / cheap-bot cluster** (same week: "cheap-bot hill-climb", "judge → gemini-3-flash FP 35%→14%", "cost-by-step", "group costs by step"). So `helpfulness` + `note_not_needed` were **extra per-note LLM calls, cut for cost** — the *free* X eval gate stayed. That makes F18 a straight **$/note vs hit-rate** trade — and since the hit-rate-driven cap is now THE binding constraint, that trade may have flipped since May. Want me to read the PR #154 body for the explicit rationale + the $/note it saved?
        - How much was it per note, this helpfulness gate, estimate?
        - How much is cost per note in general?
          > ⟢ **ANSWER** (Claude) — **fully-loaded cost/note ≈ $1.05** (last 7d: $68 spend ÷ 65 submitted — this amortises all the cheap rejected runs; cost per *run* is only $0.072). The helpfulness + note_not_needed judges were ~2 extra LLM judge calls per *candidate* → **estimate ~$0.02–0.10/note** (exact figure = the historical `COST.noteNeededJudge` step-cost; I can pull it if you want it nailed). So the gate cost **cents against a ~$1 note.** **Collapse →** *"Cut for cost, but the cost was ~cents/note (2 judge calls) vs a ~$1 loaded note and the far larger cap-value of a better hit rate — a penny-wise cut, cheap to re-add."*
- **F6.** `note_not_needed` — **AUC 0.700**. Also RETIRED 2026-06-01.
    - Again why, I sort of suspect that when we look into it this will have been a good decision or superceded with soemthing better? 
      > ⟢ **ANSWER** (Claude) — you're half-right. A note-needed judge **lives on as a cheap *pre-write* prefilter** (`runNoteNeededJudge` in cheap-bot; simple-bot's `prefilter_no_note` — the single biggest rejection reason). So the *gating* job was superseded by something cheaper + earlier — a good call. **But** that prefilter asks "is a note *worth writing* for this tweet" *before* writing; the retired `note_not_needed` **scorer** ran *after* writing and predicted *helpfulness* (0.700). Different stage, different job. So the gate was replaced; the **post-write ranking signal was lost, not replaced** — which is exactly the hole this plan fills. **Collapse →** *"Superseded as a *gate* by a cheap pre-write note-needed prefilter (good call); its post-write helpfulness signal (0.700) was dropped, not replaced — that's the gap in the ranking stack."*
- **F7.** `evaluation` — **AUC 0.67** (moderate). **LIVE, and it IS the X gate** — X's own evaluator score returned per note, gated at a threshold (0, per #272), logged as `score_type:"evaluation"` (`processTweet.ts` evalGate). That's *why* it survived the cost cut (X computes it — free) and why it predicts helpful (it's X's own quality model applied to our note). The only live scorer with predictive power. *[collapsed — Q resolved]*
    - was the helpfulness predictor adding information over and above this?
- **F8.** `tangential_correction` — AUC 0.63 (nominal). The only *relevance* dimension with signal.
- **F9.** `pedantry` — AUC 0.555, **p=0.21 → noise**, and **not currently computed** (last 7d only `evaluation` + `source_verification` are logged). Dead on both counts — ignore. *[collapsed — Q resolved]*
    - Maybe at some point we should try this again. I sort of would like tasks like this that you sometimes try. I imagine I am never gonna get to it. 
- **F10.** `source_verification` — **AUC 0.50 → zero power.** LIVE, but it's a faithfulness/citation gate, not a helpfulness predictor. Useless for this ranking.
- **F11.** Nathan's hand tags — **100% predictive** ("pedantic" 0/16 helpful, "did not engage" 0/14). The oracle: proves the signal is real and learnable; auto-scorers only approximate it.

> ⟢ **STRONG** (Claude) — the headline tension: our two *best* predictors (helpfulness 0.715, note_not_needed 0.700) are **switched off**, and the only *live* one (evaluation 0.67) is the weaker. First question of the plan is whether resurrecting the two judges beats everything else.

## C. Signals we have data for but aren't ranking on (candidates)

- **F12. Search model** (A/B `simple_bot_search` pick): net-helpful varies by arm — sonnet46 +9.3%, gpt5 +8.4%, sonnet5 +6.7%, opus48 +1.8%, pangram −15% (age-controlled: sonnet46≈sonnet5 fresh). Weak signal, and **going away** — Jim collapsed to Sonnet-5-only on 2026-07-18.
When are these numbers from. Can you go to source and update them.
  > ⟢ **ANSWER** (Claude) — **re-pulled from the DB 2026-07-18 16:46 UTC** (`tmp/search_model_hr.py`). They're **lifetime cumulative** net-helpful (every submitted note carrying that search-pick, scored at current `cn_status`) — so **maturity-confounded**: older arms are flattered because their notes have had longer to ripen. The honest, age-controlled read (fresh 0–21d notes only): **sonnet46 +6.2% ≈ sonnet5 +6.7% ≈ tied; opus48 worst (+0.0%)**. So as a *ranking* feature it's weak, AND the dimension is collapsing to one arm — my call: **drop F12 from the ranking plan** unless we deliberately re-open the search A/B for exploration.
- **F13. Response speed** = `first_seen_at − tweet_time`. Stats say 75% of Helpful notes land <12h → speed plausibly predicts CRH. Untested here.
- **F14. Note length** — there's a `src/scripts_jim/2026_03_31_note_length_investigation`. Direction unknown to me; worth reading its conclusion.
- **F15. Note embeddings / clusters** — `src/scripts_jim/2026_06_12_note_embedding_clusters`. Could give a "this looks like past-helpful notes" similarity score.
- **F16. Cheap structured features** — # sources, misleading-tag type, media type (photo/video), tweet author, claim type. All in `notes`/`tweets`/`pipeline_runs`, none tested.

## D. Proposed approach (for markup)

- **F17. Now (zero build):** rank by the live `evaluation` score, best-first. It's 0.67 — strictly better than the current FIFO/first-N submission. Ships today.
- **F18. Highest-value:** **resurrect `helpfulness` + `note_not_needed`** (the 0.715 / 0.700 judges). Blend with `evaluation`.
- **F19. Cheap adds:** `response_speed` (F13) and `tangential_correction` (F8) — both align with the core finding that notes fail on *relevance/materiality*, not correctness.
- **F20. Combine:** small logistic model on [evaluation, helpfulness, note_not_needed, speed, tangential] → single `P(CRH)`. **Validate by age-controlled AUC + backtest on the labeled set FIRST** (the relevance-layer-design principle: evolve + backrun, don't live-A/B blind).
- **F21. Target:** close the gap from ~0.7 auto to the ~1.0 hand-tag oracle. The ceiling exists (F11); we're leaving it on the table.

> ⟢ **Q** (Claude) — do we even need a model, or is `max(evaluation, resurrected-helpfulness)` enough? With only ~3–5 usable signals and small mature-n, a hand-weighted blend may beat a fitted model and is easier to trust. Lean simple first?

## E. Open questions / to verify before building

1. **Why were `helpfulness` + `note_not_needed` cut on 2026-06-01?** (Cost? If so, what per-note $, vs the cap value of a better hit rate.) — decides F18.
2. **Fix the `pipeline_scores` query path** (index / view) so we can measure anything — blocks all of B.
3. Does **speed** actually predict CRH, age-controlled? (F13)
4. What did the **note-length** and **embedding** investigations conclude? (F14/F15)
5. Is ranking even the bottleneck, or is it **generation yield** (few candidates clear any bar)? If we rarely generate more than the cap, best-first is moot — the fix is generating *more good* candidates, not ordering them.

> ⟢ **WEAK** (Claude) — E5 is the one that could kill the whole plan. If on a normal day we only produce ~9 submittable candidates and the cap is ~9, there's nothing to rank. Worth checking candidate-vs-cap supply before investing in ranking.
