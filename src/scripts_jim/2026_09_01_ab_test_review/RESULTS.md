# A/B test review (GOO-93), 2026-09-01/02

Question: are there A/B tests to shut down? Answer: yes, six were closed and
one arm was retired. The readout comes from `ab_readout.py`, which prints one
row per arm of every live test: run counts, submitted notes, and how the
settled notes were rated. A note counts as settled 48 hours after submission.
"Net" is (helpful - not_helpful) / settled notes. The all-time window mixes
periods with different sampling weights, so arms were compared inside the
August window.

## Decisions (Jim, 2026-09-02)

| Test | Decision | Evidence |
|---|---|---|
| `simple_bot_political_sources` | Code removed, behaviour = off | "on" behind at 8.2% vs 11.3% helpful all-time, z = 1.9 |
| `simple_bot_writer_examples` | Code removed, behaviour = off | dead even after ~3,900 settled notes, z = 0.6 |
| `simple_bot_correction_extraction` | Pinned off | "off" best in both windows, z ~ 0.9 vs each extractor arm, and the step costs an LLM call |
| `verifier_claim_based` | Pinned claim-based | quality per note tied (z = 1.1); Jim chose the stricter flow: 15 vs 39 unhelpful notes in August, at the cost of ~40% submission volume |
| `verifier_citations` | Pinned off (X only; Common Notes still forces on) | "off" slightly ahead, z = 0.9, no signal in 7 weeks |
| `author_history` | Pinned on_with_unhelpful | on vs on_with_unhelpful z = 0.4; the earlier "off" retirement was the one decisive result (z = 3.4) |
| `simple_bot_writer` | Sonnet 4.6 arm retired, weight to Sonnet 5 | tied Sonnet 5 exactly at 12.6% helpful in August |
| `pangram_note` | Unchanged, per Jim | "plain" ahead but only z ~ 1 |
| `timing_treatment` | Unchanged | instruction vs context still 50/50 by Nathan's 2026-08-23 call |
| `topic_filter` | Unchanged, holdout question open | the 33% "off" arm is a measurement holdout, not a race |
| `misinfo_concede_shape` | Left to GOO-94 | 43 settled notes, zero helpful on either arm |
| `simple_bot_search` | Unchanged | ongoing model scan, not a decidable test |

Weight changes live in `src/pipeline/ab-testing/abTestsData.ts`, each with a
closeout comment carrying the numbers. PR:
https://github.com/Goodheart-Labs/cn-return-bot/pull/430
