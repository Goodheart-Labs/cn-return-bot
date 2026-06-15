# iter-3 judge prompt changes — replay results

Date: 2026-05-27

## What changed

Edited [src/pipeline/simple-bot/judge.ts](../../pipeline/simple-bot/judge.ts):

1. **Reorganized the "should NOT publish" list into 7 numbered rules** (was a flat bullet list with implicit overlaps).
2. **New Rule 2** — "post is accurate; note adds context rather than disputing a claim": the bot's note must DISPUTE something the post asserted; appending adjacent info doesn't count.
3. **New Rule 3** — "in-tweet signals openly disclose non-real nature, and the note merely restates that disclosure": if a video has a game logo, AI watermark, studio branding, named comedy creator in the caption, parody-account bio, or a `POV:` framing, then a note that points that out adds nothing. Self-disclosure overrides 1-2 confused commenters; widespread (>=20%) confusion still overrides the in-tweet signal.
4. **Strengthened Rule 4** (predictions) — added explicit "expected to happen today / about to / watch X collapse" phrasing that the old prompt missed.
5. **Tightened Rule 5** (editorial framing) — calls out the "real metric, opinion framing" pattern.
6. **Restructured the rest of the prompt** so the "Reading replies" section only fires when in-tweet signals are absent.
7. **Added 6 few-shot examples** (multi-turn) drawn from `datasets/big_eval/splits/pool.jsonl` (NOT val/test):
   - **Positive**: Erika Kirk fabricated response (`2037626416276111526`); Chandra X-ray AI-generated starfield (`2025296268746993694`).
   - **Negative**: Jessica Marchi POV skit with `@JESSICAMARCHI` watermark (`2021930131733065889`); UK net-migration post (`1994000165368467648`); Netanyahu rhetorical question (`2032599639703396545`); iHeartRadio off-by-one tally (`2037544917954617717`).

Each negative example pins a specific rule (3 / 2 / 1 / 6) and the model's expected reasoning names that rule explicitly.

## Replay test on iter-2 (deepseek-v4-flash, 46 rows)

Method: extracted the cached `userMessage` for each iter-2 judge invocation from `dataset_runs/tryout-iter-02-cheap-bot-2026-05-27-1045/results_iter-02-cheap-bot.csv → logs.simpleBot.judge.messages[0]`, re-ran the new judge against the identical input, compared decisions.

| Bucket                          | n  | result                                        |
|---------------------------------|----|-----------------------------------------------|
| **False positives (FP)**        | 14 | **10 fixed (T→F)**, 4 kept (T→T)              |
| **Correct positives**           | 6  | 3 kept (T→T), 3 lost (T→F)                    |
| Missed, judge had said YES      | 17 | 14 kept (T→T), 3 lost (T→F) — verifier killed these anyway, no PASS impact |
| Missed, judge had said NO       | 9  | 0 changed (all still NO)                      |
| Parse errors (JSON malformed)   | 2  | —                                             |

**Predicted val impact**:
- PASS: 42 → ~49 (+7) — back to baseline territory.
- FP rate (val): 14/50 = 28% → 4/50 = 8% — beats baseline (10%).
- Miss rate (val): 37/50 → 40/50 — 3 worse from TP losses; recovery from the searXNG/source-verifier fixes (iter-3 proposal Fix 1+2) is unaffected by this change.

## Goodhart check — are the 3 TP losses real regressions?

Walked through each. Of the 6 T→F flips on (CORRECT ∪ MISSED-judge-yes):

| URL | Iter-2 verdict | New reasoning | Is the rejection right? |
|-----|----------------|---------------|-------------------------|
| 2041891972512936030 | CORRECT (kept) | Rule 3: media displays "NOTHING on this page is REAL" watermark — in-tweet disclosure | **Correct application of new rule** — the watermark is exactly the disclosed-fake case the rule targets. |
| 2036903878726131807 | CORRECT (lost) | Rule 2: US/Israel/Argentina UN vote — post's claim is accurate, note adds reparations context | **Borderline** — judge guidance had said note must dispute, not add. Tight reading is fine. |
| 2032514777663021439 | CORRECT (lost) | Rule 5: "wages up, prices down" — judge said editorial framing | **Genuine regression.** The post's "prices coming down" is a checkable false claim (CPI rose 3.3%). Judge over-applied Rule 5. |
| 2028943273042100353 | MISSED (was YES, lost) | Rule 1: Fetterman "last declared war was WWII" — literally accurate; Iraq/Afghanistan were AUMFs | **Reasonable** — Fetterman's claim is technically correct, the "correction" introduces new context. |
| 2039707797244215475 | MISSED (was YES, lost) | Rule 5: Trump 29% — figure appears in at least one poll, "lowest ever" is framing | **Borderline** — depends on the specific poll, but "lowest for any US president" is checkable. |
| 2031539160700313846 | MISSED (was YES, lost) | Rule 2: Islamist attack on Jewish person SF — actual location was San Jose | **Borderline** — the location detail matters for verifiability; tight reading vs not is debatable. |

Net: **1 clear regression (`2032514777663021439`), 2 borderline, 3 reasonable**. The remaining 4 "stubborn FPs" (DCS World, French TV-show meme, Amou Haji animation, Druski cop skit) are knowledge-gap failures — the LLM doesn't recognize "Druski" or DCS-World-game-UI even though the rule text describes the pattern. A future iteration could add a "named comedy creators" list and a Druski-specific fewshot.

## Stubborn FPs that did NOT flip

| URL | Why it stayed FP |
|-----|------------------|
| 2028333038547927472 (DCS World) | LLM didn't notice game-UI elements as a "visible logo" cue; partisan caption pulled it toward "real footage". |
| 2004901660578254936 (French TV show meme) | LLM treated the ironic caption as a literal factual claim — didn't read meme register. |
| 2006395901426737233 (Amou Haji animation) | LLM rated the timing-off-by-months as substantive instead of Rule 6 pedantry on an animated retelling. |
| 2017441660578254936 (Druski cop skit) | "Druski" is named in the caption but the model doesn't recognize him as a comedy creator. A named-creators fewshot would likely fix this. |

## Recommendation

Land the judge changes as-is. The expected val numbers (PASS ~49, FP rate ~8%) are a clear net win vs iter-2 (42, 28%) and approximately match baseline (49, 10%) but with lower FP rate. A val re-run will confirm.

If we want to push further on the 4 stubborn FPs, the next move is one more fewshot covering "named comedy creator" (Druski-style) and "meme-register ironic captions" (French TV show style). I'd defer that until we see val confirmation that the current changes hold.
