# A/B test log

The record of every A/B test decision, with the numbers it rested on. The test
definitions themselves live in `src/pipeline/ab-testing/abTestsData.ts`, which
carries only one-line contracts. When you open, close, or retire an arm, add a
row here in the same commit.

**Reading the numbers.** A note counts as *settled* 48 hours after submission.
*Net* is (helpful − not helpful) / settled notes. *z* is a two-proportion z on
the helpful rate. Weights are relative, not percentages. A retired arm keeps
weight 0 so historical picks still resolve; a test removed from `AB_TESTS`
keeps its historical labels readable in the dashboards, but can no longer be
forced.

## Decisions

| Date | Test | Decision | Evidence | Who |
|---|---|---|---|---|
| 2026-07-28 | `time_travel_prompt` | Opened 50/50 as PR #323 after backtest | Backtest over 398 rated notes flagged 9 not-helpful against ~3 helpful: removes 11–15% of NH notes, costs ~1% of helpful. A companion "absence of reports" rule came out inverted (9 helpful vs 5 NH) and was dropped. Background: `docs/improvement-menu-2026-07-25.md` item T2 | Nathan |
| 2026-08-05 | `time_travel_prompt` | Retired in favour of the `instruction` arm of `timing_treatment` | The instruction and the timing-context treatment compete rather than compose, so one three-arm test (off / instruction / context) replaced the 2×2 | Nathan |
| 2026-08-06 | `simple_bot_anti_pedantic` | Closed → **on**; prompt folded into `SEARCH_SYSTEM_PROMPT` | Jun 24–Aug 3, both arms live: on +7.1% net (n=945, 76% of rated notes helpful) vs off +6.1% (n=918, 73%). Reopen if settled outcomes reverse once recent weeks mature | Jim |
| 2026-08-06 | `note_prefilter` | Closed → **deepseek** at 100 | deepseek +7.0% net (n=2085, 75% of rated helpful) vs off +6.6% (n=774, 73%). Same quality, saves a search per rejected post. A scheduled discard audit now measures false negatives; reopen if it finds lost notes | Jim |
| 2026-08-18 | `simple_bot_writer` | Refreshed | Sonnet 5 promoted to co-baseline, Sonnet 4.6 wound down to a continuity arm, Fable 5 ($10/$50 per MTok) and Opus 5 ($5/$25) added at low weight (a few notes/day each) | Nathan |
| 2026-08-23 | `timing_treatment` | **off** arm retired; instruction vs context continues 50/50 | First 7-day-labeled readout: off +6.0% net (26H/11NH, n=248), context +10.0% (31H/8NH, n=229), instruction +12.2% (33H/6NH, n=222). Both treatments lifted rated-at-all ~15% → ~17.5%. Treatments-vs-off z≈1.7, suggestive, but same direction as the backtest, and the control was plausibly costing ~5pp net on a third of traffic | Nathan |
| before 2026-09-01 | `author_history` | **off** arm retired | off +3.5% net (n=579) vs +8.4% and +8.9% for the two history arms, z≈3.4 on the helpful rate. The one decisive result of the 2026-09-01 review | Jim |
| 2026-09-02 | `simple_bot_political_sources` | Code removed, behaviour = off | on behind at 8.2% vs 11.3% helpful all-time, z=1.9 | Jim |
| 2026-09-02 | `simple_bot_writer_examples` | Code removed, behaviour = off | Dead even after ~3,900 settled notes, z=0.6 | Jim |
| 2026-09-02 | `simple_bot_writer` | Sonnet 4.6 arm retired, weight to Sonnet 5 | Tied Sonnet 5 exactly at 12.6% of settled notes helpful in August | Jim |
| 2026-09-02 | `simple_bot_correction_extraction` | Closed → **off**; stage removed in PR #444 | Since Aug 1: off +10.3% net (n=622, 13.3% helpful) vs gemini3flash +8.7% (n=583) and sonnet5 +9.1% (n=560), z≈0.9 against each. Extraction also cost an extra LLM call per run | Jim |
| 2026-09-02 | `verifier_claim_based` | Closed → **claim-based** (Common Notes still forces classic) | Quality per submitted note tied (z≈1.1). August, equal traffic: classic submitted 1235 notes (134H/39NH), claim-based 698 (86H/15NH). Stricter flow chosen: fewer unhelpful notes at ~40% less volume | Jim |
| 2026-09-02 | `verifier_citations` | Closed → **off** on X (Common Notes forces on for its public per-source quotes) | Seven weeks, ~2100 settled: since Aug 1 off +10.5% net (n=866) vs on +8.3% (n=899), z≈0.9 | Jim |
| 2026-09-02 | `author_history` | Closed → **on_with_unhelpful** | Since Aug 1: 12.1% vs 12.8% of settled notes helpful, z≈0.4. The rejected-notes block costs nothing and is a plausible tell of a satire or opinion account | Jim |
| 2026-09-06 | `pangram_note` | Removed from `AB_TESTS`; now sampled only in `generatePangramCandidates` (PR #444) | Every ordinary run had been drawing a 50/50 label with empty overrides, so the 2026-09-01 readout ("plain ahead, z≈1") compared untreated traffic. See caveat below | Nathan |

## Still running

| Test | State | Notes |
|---|---|---|
| `simple_bot_search` | Ongoing model scan | `opus48-native` garbled ~80% of runs (native web search collided with the json_schema response format); the Opus arms run Opus 5 now, watched for the same failure. The `-serper` arms restarted under new names in Sept 2026 when Serper replaced SearXNG; `-searxng` names stay at weight 0 and replay against Serper |
| `simple_bot_writer` | Sonnet 5 50 / Gemini Flash 30 / small Anthropic arms | |
| `simple_bot_verifier` | Gemini Flash baseline | deepseek-v4-flash arm trialled, now weight 0; numbers not recorded |
| `timing_treatment` | instruction vs context 50/50 | Read process metrics first: abstention rate, then Nathan's breaking-news tag rate. Per-arm cn_status stays underpowered for months |
| `writer_last_check` | 50/50 (PR #442, 2026-09-04) | Read abstention rate first |
| `topic_filter` | 33% off holdout | A measurement holdout, not a race |
| `misinfo_concede_shape` | Left to GOO-94 | 43 settled notes, zero helpful on either arm as of 2026-09-02 |
| `eval_submit_threshold` | Fixed at −3 | Older arms 0 and −6 at weight 0; numbers not recorded |
| `ranking_policy` | velocity_only vs flags_then_eval 50/50 | Picked once per run |

## Caveats for readouts

- **`pangram_note` before 2026-09-06.** The label sat on every ordinary run.
  Any readout must add `and r.bot_name = 'pangram-monitoring'`, or the arms are
  two identically treated halves of ordinary traffic.
- **`author_history` before June 2026.** The lookup was silently broken from
  migration 033 (it queried `pipeline_runs.author_id` after the column was
  dropped), so the input was effectively off. `defaultVariant: "off"` reflects
  the behaviour rows actually had.
- **`feed_size`.** A missing pick means `small`: true of everything before the
  ladder landed on 2026-06-06, and the right fallback for 2026-07-21/22 when the
  pick was dropped by accident.
- **All-time windows** mix periods with different sampling weights. Compare arms
  inside a window where the weights were stable (the 2026-09-01 review used
  August).

## Sources

- `src/scripts_jim/2026_09_01_ab_test_review/RESULTS.md` and `ab_readout.py`
  (the 2026-09-02 round).
- Closeout comments in `abTestsData.ts` as of commit `30366b36`, moved here by
  PR #444.
