# Writing-limit audit — sources to check

Purpose: put every source I've been reasoning from in one place, verbatim, so Nathan can find the bullshit. Each **CLAIM** is tagged with the **SOURCE** that backs it and a **CHECK** (how to reproduce). Mark up inline with `> ⟢ **VERB** (Nathan) —` lines.

Question under investigation: *why is our note-writing capped at ~10/day, and when does it ease?*

---

## SOURCE A — X's official AI-Note-Writer limit formula (the rulebook)

- Page: https://communitynotes.x.com/guide/en/api/overview  (the "Contributing" section — this is the page in the Jay Baxter screenshot)
- Repo mirror: https://github.com/twitter/communitynotes/blob/main/documentation/contributing/writing-notes.md

**Verbatim definitions (transcribed from the screenshot):**

- `WL` = Daily writing limit
- `WL_L` = Internal writing limit (the writing limit before accounting for the delta in writing volume vs. DN_30)
- `NH_5` = Number of notes with CRNH ("Currently Rated Not Helpful") status among **last 5 notes with a non-NMR status**
- `NH_10` = Number of notes with CRNH status among **last 10 notes with a non-NMR status**
- `HR_R` = Recent hit rate (e.g. `(CRH-CRNH)/TotalNotes` among **most recent 20 notes**)
- `HR_100` = `(CRH-CRNH)/TotalNotes` among **most recent 100 notes**
- `HR_14d` = Hit rate over the **last 14 days, excluding notes with <10 ratings that have not been assigned Helpful or Not Helpful status** (`(CRH-CRNH)/TotalNotes` among qualifying notes from the last 14 days)
- `HR_L` = `max(HR_100, HR_14d)`
- `DN_30` = Average daily notes written in last 30 days
- `T` = Total notes written

**Verbatim writing-limit logic:**

```
If NH_10 >= 8:           WL = 2
Else If NH_5 >= 3:       WL = 5
Else:
  If T < 20 (new):       WL = 10
  Else:
    If HR_L < 0.05:      WL_L = 300 * max(HR_R, HR_L)
    Else If HR_L < 0.1:  WL_L = 15 + 700 * (HR_L - 0.05)
    Else If HR_L < 0.15: WL_L = 50 + 3000 * (HR_L - 0.1)
    Else If HR_L < 0.2:  WL_L = 200 + 6000 * (HR_L - 0.15)
    Else:                WL_L = 500
    WL = max(5, floor(min(DN_30 * 5, WL_L)))
```

Closing line on the page: *"We will require that AI Note Writers write notes regularly enough to maintain access to the API…"*

> ⟢ **Q** (Claude) — the biggest open question: **is our production account even subject to THIS formula?** This is the *AI Note Writer* page. There's a *separate*, simpler formula for general contributors (`min(WritingImpact+5, hitRate×200)`). We never confirmed which one `wholesome-raspberry-stilt` is on. If it's a general contributor, this whole page is the wrong rulebook.

---

## SOURCE B — our implementation of Source A

File: `src/pipeline/orchestration/updateWritingLimit.ts`

> ⟢ **CHECK** — **the entire file is commented out.** Lines 1-6:
```
/**
 * Update Writing Limit
 * Disabled — the computed writing limit doesn't work properly.
 * Writing limit is now only updated when the daily limit is hit during submission.
 */
```

**`hitRate()` — lines 65-70 (verbatim):**
```ts
function hitRate(notes: WrittenNote[]): number {
  if (notes.length === 0) return 0;
  const crh = notes.filter((n) => n.status === "currently_rated_helpful").length;
  const crnh = notes.filter((n) => n.status === "currently_rated_not_helpful").length;
  return (crh - crnh) / notes.length;
}
```

**`computeWritingLimit()` — lines 86-143 (verbatim):**
```ts
function computeWritingLimit(notes: WrittenNote[]): WritingLimitVars {
  const sorted = [...notes].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)); // most recent first

  const T = sorted.length;

  // Non-NMR notes for NH_5/NH_10
  const nonNmr = sorted.filter((n) => n.status !== "needs_more_ratings");
  const NH_5 = nonNmr.slice(0, 5).filter((n) => n.status === "currently_rated_not_helpful").length;
  const NH_10 = nonNmr.slice(0, 10).filter((n) => n.status === "currently_rated_not_helpful").length;

  const HR_R = hitRate(sorted.slice(0, 20));
  const HR_100 = hitRate(sorted.slice(0, 100));

  // HR_14d: notes from last 14 days, excluding minimum_ratings_not_met
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentQualifying = sorted.filter((n) => {
    const ts = snowflakeToTimestamp(n.id);
    if (ts < fourteenDaysAgo) return false;
    return n.status !== "minimum_ratings_not_met";
  });
  const HR_14d = hitRate(recentQualifying);

  const HR_L = Math.max(HR_100, HR_14d);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const notesInLast30 = sorted.filter((n) => snowflakeToTimestamp(n.id) >= thirtyDaysAgo).length;
  const DN_30 = notesInLast30 / 30;

  if (NH_10 >= 8)  return { ...vars, WL: 2, branch: "NH_10 >= 8" };
  if (NH_5 >= 3)   return { ...vars, WL: 5, branch: "NH_5 >= 3" };
  if (T < 20)      return { ...vars, WL: 10, branch: "T < 20 (new writer)" };

  let WL_L: number;
  if (HR_L < 0.05)      WL_L = 300 * Math.max(HR_R, HR_L);
  else if (HR_L < 0.1)  WL_L = 15 + 700 * (HR_L - 0.05);
  else if (HR_L < 0.15) WL_L = 50 + 3000 * (HR_L - 0.1);
  else if (HR_L < 0.2)  WL_L = 200 + 6000 * (HR_L - 0.15);
  else                  WL_L = 500;

  const WL = Math.max(5, Math.floor(Math.min(DN_30 * 5, WL_L)));
  return { ...vars, WL_L, WL, branch: "standard formula" };
}
```

> ⟢ **NOTE** (Claude) — code faithfully matches Source A. One mapping to check: the doc says *"excluding notes with <10 ratings not assigned H/NH"*; the code implements that as `status !== "minimum_ratings_not_met"` (line 106). That mapping (`minimum_ratings_not_met` == "<10 ratings, unassigned") is the author's interpretation of X's status semantics.

---

## SOURCE C — how the cap is ACTUALLY set right now (Source B is disabled)

File: `src/pipeline/orchestration/writingLimit.ts` — this one is **live**.

**Lines 32-39 (verbatim):**
```ts
/** Daily-limit error from X: cap is exactly the current submission count. */
export async function recordDailyLimitHit(logger: SupabaseLogger): Promise<void> {
  const count = await logger.countRecentSubmissions(SUBMISSION_WINDOW_HOURS); // 24h
  await logger.setPipelineState(LIMIT_HIT_AT_KEY, new Date().toISOString());
  await logger.setPipelineState(LIMIT_HIT_VALUE_KEY, String(count));
  await logger.setPipelineState(STATE_KEY, String(count));
}
```

File header (lines 1-8): *"The value is observation-based: it only moves in response to X's actual responses. We never infer it from submission counts alone…"*

> ⟢ **CLAIM** (Claude) — so our stored `writing_limit` = **whatever count we'd submitted in the trailing 24h when X returned a daily-limit 403.** It is NOT computed from Source A/B. Source B (the formula) is only a *monitor/predictor*, and it's disabled. The real cap is X's server, discovered by hitting it.
> **CHECK:** `pipeline_state` table — `writing_limit=10`, `limit_hit_at=<today>`.

---

## SOURCE D — the data limitation (why my HR_14d / NH numbers are approximations)

**CLAIM:** our mirror can't represent the status the formula depends on.

- X's status enum has **7 values** (`src/api/fetchNotesWritten.ts:4-11`): `currently_rated_helpful`, `currently_rated_not_helpful`, `firm_reject`, `insufficient_consensus`, `minimum_ratings_not_met`, `needs_more_ratings`, `needs_your_help`.
- Our Supabase `notes.cn_status` only ever holds **3**: `NEEDS_MORE_RATINGS`, `CURRENTLY_RATED_HELPFUL`, `CURRENTLY_RATED_NOT_HELPFUL`. The scraper collapses the rest into `NEEDS_MORE_RATINGS`.
- **`HR_14d` excludes `minimum_ratings_not_met`** — a status **our data does not have.** So `HR_14d`, `NH_5`, `NH_10` (which also filter on non-NMR statuses) **cannot be computed correctly from the mirror.**

> **CHECK:** `select cn_status, count(*) from notes group by cn_status` → only the 3 values. (Also: the March-account API pull returned only those same 3 in practice — so `minimum_ratings_not_met` may be rare, but we can't assume.)

---

## What survives vs what doesn't (my current read)

| Claim | Backed by | Status |
|---|---|---|
| Cap is observation-based, not formula-computed | Source C (live code) | **solid** |
| The NH_5/NH_10 + HR_L formula is X's real AI-writer spec | Source A (X page) = Source B (code) | **solid** (if account is AI-writer) |
| Quality is NOT falling; Mar–Apr dip recovered, May–Jun stable ~10% net | mirror terminal statuses (reliable) | **solid** |
| ~13% of notes eventually rated Helpful, ~3% Not-Helpful, ~82% never | mirror maturation curve | **solid** |
| Our current `HR_14d` ≈ 3% (→ cap 10) | mirror — **missing `minimum_ratings_not_met`** | **UNRELIABLE** |
| "Structurally stuck at 10–15, won't recover" | built on the unreliable HR_14d | **RETRACTED** |
| Which account/formula production is on | never confirmed | **UNKNOWN** |

## Open contradictions for Nathan to poke

1. **Observed cap 10** ⇒ `HR_L ≈ 3.3%`. But if `HR_14d` (with the min-ratings exclusion) reflects true rated quality (~10% net), it should be ~10% ⇒ cap ~50. Either quality-among-rated really is ~3%, or we're not on this formula, or the mirror is lying. **Can't resolve without X's granular statuses.**
2. **65/day in June** can't be produced by this formula at any hit rate we've had (~8–13%) — implies the cap simply wasn't *binding* then. Check: when did `daily_limit_reached` first fire in `pipeline_runs`?
3. **Account identity:** `.env` keys = a 296-note account dormant since Mar 29; `.env.prod-writer` = "not admitted for test_mode=false". Neither is the 5,681-note July writer. So we've never actually queried the production account's `notes_written`.

## The one measurement that closes most of this
`notes_written` for the **admitted production account** — gives X's real per-note status (all 7 values), which lets us compute `HR_14d`/`NH` exactly and settle contradictions #1 and #3. Needs that account's OAuth creds.
