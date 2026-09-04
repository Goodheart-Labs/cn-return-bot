# GOO-94: do the topic-based notes work? (2026-09-01)

Jim's ticket says the topic-based ones can be shut down because "~ none work".
This measures that premise before acting on it. Run `measure.ts` from the repo
root with bun to reproduce; it reads prod `pipeline_runs` and `notes`.

"Topic-based" here means the misinfo-monitoring pipeline in
`src/pipeline/misinfo-monitoring/`: a keyword pre-pass over the big X feed plus
the same matching on the regular feed pool, scoped to hand-curated topics
(AI water use, Trump election security, and so on). Every run it produces is
tagged in `pipeline_runs.ab_test_picks` with `misinfo_monitoring: "yes"` and
its `misinfo_topic`, which is what the script counts.

## Result: the premise holds, and it is not even "~ none". It is none.

Window measured: 2026-06-01 to 2026-09-01 (the entire life of the feature).

| | Topic-based | Regular (same window) |
|---|---|---|
| Runs | 924 | not counted (only submitted fetched) |
| Notes submitted | 174 | 4611 |
| Rated helpful | **0 (0.0%)** | 521 (11.3%) |
| Rated not helpful | 2 | 157 |
| Still "needs more ratings" | 172 | 3914 |
| Views recorded by scraper | 0 | 30,782,900 |
| LLM cost of all runs | $138.72 | not counted |

Runs per topic: trump_election_security 652, ai_water 218, openai_dod 31,
datacenter_land 12, ai_energy_carbon 8, ai_training_emissions 2,
save_our_bacon 1. Only trump_election_security was still active at shutdown
time; the others ran in June/July campaigns.

Submitted notes per topic: trump_election_security 127, ai_water 44,
ai_energy_carbon 2, openai_dod 1.

## Reading

Not a single topic note out of 174 was ever rated helpful, across every topic
tried, over three months. The regular pipeline's 11.3% helpful rate in the same
window shows the rating system does reward our notes when they land. The topic
notes also recorded zero scraper views, which means none of them was ever shown
on a post. The $138.72 total LLM cost is small; the real cost was the daily
submission slots these notes consumed (174 submissions that displaced nothing
helpful, but each counted against the X writing limit).

## What was switched off

`src/production/runPipeline.ts`: `MISINFO_PIPELINE_ENABLED` set to false and
`MISINFO_ACTIVE_TOPIC_IDS` emptied. The first stops the big-feed pre-pass, the
second stops the topic curation inside the regular pass. All code, topics,
documents, briefs, and the `misinfo_monitoring_sightings` data stay in place.
Reverting those two lines turns everything back on.
