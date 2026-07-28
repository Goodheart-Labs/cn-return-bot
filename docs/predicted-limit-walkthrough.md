# Predicted writing-limit PR — code walkthrough (quiz)

The PR: predict X's daily writing cap from our own note history, then post a **half-step** toward it. Below are the specific blocks. Under each is a **Q for Nathan** — answer in your own words (plain text, right under the `⟢ Q`), and I'll confirm or correct. Goal: you understand every block before we merge.

---

## Block 1 — the hit-rate helper (`predictWritingLimit.ts`)

```ts
function hitRate(notes: NoteRow[]): number {
  if (notes.length === 0) return 0;
  let crh = 0, crnh = 0;
  for (const n of notes) {
    const s = normStatus(n.cn_status);
    if (s === CRH) crh++;
    else if (s === CRNH) crnh++;
  }
  return (crh - crnh) / notes.length;   // divides by ALL notes, incl. never-rated (NMR)
}
```

> ⟢ **Q1** (Claude) — The denominator is `notes.length` — *every* note in the window, including the ~82% that never get rated. Given that, what happens to `hitRate` if we suddenly write a big burst of notes, and why is that the behaviour X *wants*? 
- Well it falls a lot if it's a large percnetage of all previous ntoes written and doesn't change much if it isn't.

> ⟢ **✓ mostly right** (Claude) — Correct on the mechanism: a burst dilutes the rate in proportion to how much of the window it fills. Two refinements + the bit you skipped:
> **(1) *why* it falls** — the fresh notes are **unrated (NMR)**, so they add to the *denominator* but zero to the *numerator*. They're dead weight until they earn Helpful (most never do).
> **(2)** it's a % of the **window** (most-recent-100 notes, or last-14d), not all history — so a burst big enough to fill the recent-100 window tanks it hard even if it's small vs all-time.
> **(3) the part you left out — why X *wants* this:** it's the **anti-spam lever**. Flooding the system with notes (most of which never get rated helpful) *lowers* your cap → you're forced toward **fewer, better** notes instead of volume. This is literally why our cap fell when we sprayed in July.

---

## Block 2 — the HR_14d exclusion (`predictWritingLimit.ts`)

```ts
const qualifying = sorted.filter((n) => {
  if (!n.submitted_at || new Date(n.submitted_at).getTime() < fourteenDaysAgo) return false;
  const isUnderRatedNmr =
    normStatus(n.cn_status) === NMR && (ratingTotals.get(n.note_id) ?? 0) < MIN_RATINGS_FOR_HR14D; // <10 ratings
  return !isUnderRatedNmr;   // drop too-fresh, barely-rated notes from THIS window
});
const HR_14d = hitRate(qualifying);
const HR_L = Math.max(HR_100, HR_14d);
```

> ⟢ **Q2** (Claude) — `hitRate` (Block 1) keeps every note. This `HR_14d` window instead throws out NMR notes with fewer than 10 ratings. Why exclude *those specific* notes here — what mistake is it preventing? (Hint: it's about the difference between "people looked and didn't find it helpful" vs "…?")
- something like cos that's most of them? they aren't much signal espsecially for the big note writers??

> ⟢ **~half** (Claude) — Right instinct ("fresh notes aren't much signal"), but the sharp version is **your own earlier point**: this is X **accounting for approval lag**. It splits NMR notes into two kinds:
> **<10 ratings** = "**hasn't really been looked at yet**" → too fresh to judge → **exclude** (counting it against you would punish the *lag*, not the quality).
> **≥10 ratings but still NMR** = "**people looked and it didn't reach Helpful**" → real signal → **keep**.
> So it prevents **mistaking "not rated *yet*" for "rated and found unhelpful."** (You literally asked earlier "surely they take into account that things take a while to be approved?" — this exclusion *is* that.) The "big note writers" angle isn't the point — it's about *time-since-written*, applies to everyone.

---

## Block 3 — the limit formula (`predictWritingLimit.ts`)

```ts
if (NH_10 >= 8) return { ...base, wl: 2, ... };   // 8 of last 10 rated notes = Not Helpful → floor
if (NH_5 >= 3)  return { ...base, wl: 5, ... };
if (T < 20)     return { ...base, wl: 10, ... };  // brand-new writer

let WL_L: number;
if      (HR_L < 0.05) WL_L = 300 * Math.max(HR_R, HR_L);
else if (HR_L < 0.10) WL_L = 15  + 700  * (HR_L - 0.05);
else if (HR_L < 0.15) WL_L = 50  + 3000 * (HR_L - 0.10);
else if (HR_L < 0.20) WL_L = 200 + 6000 * (HR_L - 0.15);
else                  WL_L = 500;

const wl = Math.max(5, Math.floor(Math.min(DN_30 * 5, WL_L)));
```

> ⟢ **Q3** (Claude) — The slope gets steeper each bracket (700 → 3000 → 6000). In plain terms: if we nudged our hit rate from 6% to 8%, does the cap go up a little or a lot — and what does that tell us about where to spend effort?

---

## Block 4 — the half-step (`computeMaxPosts.ts`)

```ts
const headroom = prediction.wl - submitted;                          // e.g. 21 - 12 = 9
let remainingSlots = Math.max(0, Math.floor(HALF_STEP_FRACTION * headroom));  // 0.5 * 9 = 4

const coolingOff = await hitWritingLimitRecently(logger, POST_403_COOLDOWN_HOURS);
if (coolingOff) remainingSlots = 0;
```

> ⟢ **Q4** (Claude) — With predicted 21 and 12 already posted, `remainingSlots` = 4, not 9. Two-part: (a) why did we deliberately leave the other ~5 unused, and (b) what is the `coolingOff` line protecting against?

---

## Block 5 — the fail-soft fallback (`computeMaxPosts.ts`)

```ts
const prediction = await predictWritingLimit();
if (prediction === null) {
  console.warn("[posting-strategy] prediction unavailable — falling back to observed-cap rationing");
  return legacyObservedBudget(logger);   // the OLD behaviour
}
```

> ⟢ **Q5** (Claude) — `predictWritingLimit()` returns `null` if it can't read the data. Why is falling back to the *old* limit logic here better than either (a) crashing, or (b) just posting nothing?

Cos without limits we just write loads of notes and that is waste ful of money.

> ⟢ **partial** (Claude) — Right that we want to stay *bounded*. But the question was fallback-to-old vs the two alternatives, and the crux is **graceful degradation**: if the predictor breaks, falling back to the old observed-cap logic keeps us **writing safely at a known-good rate** — whereas **(a) crashing** kills the whole pipeline (hard failure, zero notes) and **(b) posting nothing** takes us *dark* (zero coverage/impact) for no reason when a perfectly good old method is sitting right there. So: keep functioning, don't break *and* don't go silent. Your "write loads → waste" point is actually the argument against a *fourth* option — removing limits entirely — also correct, just not one of the three.
---

## Block 6 — the calibration log (`writingLimit.ts`, fires only on a real 403)

```ts
const predicted = predictedRaw != null ? Number(predictedRaw) : NaN;
if (Number.isFinite(predicted)) {
  console.log(`[posting-strategy] MISS predicted_WL=${predicted} actual_refused_at=${count} over_predicted_by=${predicted - count}`);
}
```

> ⟢ **Q6** (Claude) — This runs only when X actually refuses us. (a) If `over_predicted_by` is +6, what did the predictor get wrong? (b) Why can this line catch "predicted too HIGH" but is blind to "predicted too LOW"?

Oh I think I maybe want it to run in general at least today but this is a good suggestion, like what if we then run too low.

> ⟢ **✓ you found the real gap** (Claude) — (a) `over_predicted_by = +6` means the predictor said the cap was **6 higher** than where X actually refused — guessed too high by 6. (b) You nailed the asymmetry: **too-HIGH is an *event*** (we push above the real cap → X 403s → we log it); **too-LOW is *silent*** (we under-post, X never refuses, nothing to catch). And your worry is exactly the structural blind spot: **with the 15% reserve we *never* test the true ceiling, so we can't detect under-prediction — we'd quietly under-post forever.** Two fixes: occasionally **probe above target** (write a couple extra to see if X allows it), or that's literally what **dialing the reserve toward 0** does over time. Worth a deliberate probe once the base version proves out.
