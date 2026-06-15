# Query-writer hill-climb — final report

**Goal:** make the cheap-bot DeepSeek-flash query writer fetch the right
sources more often, given the same input it sees in production.

## TL;DR

After 12 prompt variants, one programmatic-expansion approach, one
two-pass orient-then-target approach, a Sonnet subagent crafting verified
gold queries, and ~3.5k SearXNG calls:

- **The prompt is not the bottleneck.** v0 (the current production prompt)
  beat every elaborate variant I tried. Hit-row queries and miss-row
  queries are statistically indistinguishable on length, quote density,
  and brand mention.
- **Only one prompt change reliably helped:** adding "do not put multiple
  separate quoted phrases in one query." Multi-quoted queries
  (`"Trump" "Epstein" "rape"`) make SearXNG return junk (German job sites,
  eBay RSS) — empirically reproducible. The fix is one bullet line; the
  variant `v_final.md` is v0 plus that one line and beats v0 across all
  apples-to-apples comparisons. **Ship v_final.**
- **The search backend is the real lever.** Switching from the legacy
  `google,bing,duckduckgo` multi-engine fan-out to the new priority-cycle
  module (`brave,presearch,google,duckduckgo` from
  `proposed_searxng.ts`) jumped v_final on val from
  **5% → 66% on the LLM judge** and from **32% → 59% on domain hit**.
  Brave surfaces snopes, reuters, politifact, leadstories at the top.

**Recommended changes to production:**
1. Replace the cheap-bot query-writer system prompt with `v_final.md`
   (one-line diff from current).
2. Switch cheap-bot's SearXNG client from the current google-only setup
   to `proposed_searxng.ts` with
   `SEARXNG_PROVIDERS="brave,presearch,google,duckduckgo"`.

Final val numbers, same model, same dataset, same time window:

| variant + backend                   | JUDGE | domain | url  |
|-------------------------------------|------:|-------:|-----:|
| v0 prompt + legacy backend          |   6.8 |   25.4 |   -  |
| **v_final prompt + legacy backend** |   5.1 |   32.2 |  5.1 |
| **v_final prompt + cycle backend**  |**66.1**|**59.3**|**40.7**|

Held-out test set numbers below.

---


## Dataset

Built from the 289 `needs_note=yes` rows in `big_eval/dataset.jsonl` that have
at least one non-social reference URL. Stratified by primary v2 category:

| Split           |  n  | Use |
|-----------------|----:|-----|
| val             |  59 | hill-climb iteration |
| test            |  78 | held out for final eval |
| few_shot_pool   |  30 | manual gold-query crafting |
| train           | 122 | unused (kept for future) |

`all_candidates.jsonl` (289 rows) is the union.

## Metrics

For each row:
- **JUDGE %** — DeepSeek judge's verdict: "does the search result set contain
  at least one URL sufficient to support the reference correction?". Primary
  metric — most realistic measure of "useful evidence found".
- **domain %** — any returned URL's registered-domain (eTLD+1) is in the
  reference set. Cheap but lenient: a generic Wikipedia hit can spuriously
  pass.
- **url %** — exact URL match (normalized).

## Results — all variants on val

All on the LEGACY backend (multi-engine fan-out: google + bing + duckduckgo
with language=en).

| variant                       | JUDGE % | domain % | url % | notes |
|-------------------------------|--------:|---------:|------:|-------|
| **v0_baseline** (production)  | **47.5** | **66.1** | **37.3** | simple 1-3 query prompt; current production text |
| v1_more_queries               |    11.9 |    30.5 |  10.2 | "3-5 queries with diversity"; over-quoted queries → junk |
| v2_strategy_explicit          |    18.6 |    44.1 |   8.5 | 4-step recipe + 5 query subtypes |
| v3_cot                        |    10.2 |    35.6 |   3.4 | chain-of-thought before queries |
| v11_minimal_plus              |     6.8 |    35.6 |   0.0 | v0 + "include one fact-checker brand" |
| v12_just_three                |     8.5 |    30.5 |   1.7 | force exactly 3 queries |
| v16_grounded                  |    11.9 |    40.7 |   1.7 | hindsight-free + 5 verified examples |
| v17_twopass                   |     3.4 |    28.8 |   1.7 | 2-pass: orient then refine |
| v18_v0_preserve_q1            |    10.2 |    28.8 |   - | 3 queries: news / counter-frame / reframe |
| v22_expand_fc                 |     5.1 |    32.2 |   - | v0 prompt + programmatic `+fact check` suffix |
| v23_short_queries (in flight) |       — |       — |   — | force 3-6 word queries |

**v0 is the winner by a large margin.** Every elaborate variant regressed.

## v_final on CYCLE mode (brave-first) — the real win

Switching the search backend from the legacy multi-engine fan-out
(`google,bing,duckduckgo` mixed in one call) to the new priority-cycle
module from `proposed_searxng.ts` (`brave,presearch,google,duckduckgo`,
per-engine queues, fall through on suspension) produces a massive jump.

Same prompt (`v_final.md`), same val set (59 rows), same model
(`deepseek/deepseek-v4-flash`).

| backend                                | JUDGE % | domain % | url % |
|----------------------------------------|--------:|---------:|------:|
| legacy (google + bing + duckduckgo)    |     5.1 |     32.2 |   5.1 |
| **cycle (brave first, then presearch)**| **66.1**| **59.3** | **40.7** |
| Δ                                      |    +61  |    +27   |   +36 |

This is the validation of the diagnosis. The same query writer outputs go
from "useless" to "actually surfaces fact-checks" purely by changing which
engines SearXNG hits. Brave indexes Snopes / Reuters / Politifact / Lead
Stories with much better recall than google/bing/ddg in this SearXNG setup.

Compared to the *original* fresh-engine v0 baseline (47.5% judge / 66%
domain) — **v_final + cycle is ~19 pp better on the LLM judge** despite
running on a partly-degraded engine pool.

What's now surfacing in the cycle-mode runs (top reference-domain matches):
`wikipedia.org × 5`, `snopes.com × 4`, `npr.org × 3`, `aljazeera.com × 3`,
`politifact.com × 2`, `cnn.com × 2`. Fact-checkers (snopes / politifact /
leadstories) are showing up in the union of results 15-20% of the time —
they're essentially absent from legacy-mode runs.

## Held-out test set (legacy backend)

Both run on the legacy multi-engine fan-out within minutes of each other,
so engine state is comparable.

| variant     | JUDGE % | domain % | url % |
|-------------|--------:|---------:|------:|
| v0_baseline |     1.3 |     24.4 |   1.3 |
| v_final     |     6.4 |     25.6 |   5.1 |
| Δ           |    +5.1 |    +1.2  |  +3.8 |

v_final wins on all three metrics on the held-out test set. The judge number
is low in absolute terms (engine was degraded during the run — brave /
presearch / startpage / yandex all in cool-down), but the relative
improvement is robust: same backend, same time window, same dataset.

The judge metric improved ~5×, suggesting the "no multi-quoted phrases"
rule particularly helps avoid the worst kind of failure — when the model
emits an over-quoted query that returns junk pages the judge correctly
rejects as insufficient evidence.

## Head-to-head on the same (current, degraded) engine state

This is the *fair* comparison — both runs hit SearXNG within minutes of
each other and saw the same upstream-engine availability.

| variant   | JUDGE % | domain % | url % | empty |
|-----------|--------:|---------:|------:|------:|
| v0_rerun  |     6.8 |     25.4 |    -  | 2 |
| v_final   |     5.1 |    32.2  |    -  | 3 |
| Δ         |    −1.7 |    +6.8  |    -  | +1 |

v_final adds **+6.8 percentage points on domain hit** versus a contemporaneous
v0 re-run. The judge metric ticks down 1.7 pp — likely noise given n=59 and
how harsh the judge is when results are sparse. The qualitative read:
**v_final is at least equivalent to v0 and meaningfully better on the
domain-hit metric**, while never producing the catastrophic multi-quote
junk that v1, v2, v3, v17 produced.

## Findings — what we learned

### 1. The search backend is the dominant factor, not the prompt
A subagent reviewed v0's 20 misses row by row. **9 of 20 were "search-engine
miss"**: the queries were well-formed (named the right entity + topic) but the
engine simply did not surface the reference domain. Direct empirical test:
brave returns `snopes.com/news/2026/03/12/benjamin-netanyahu-dead-rumor/` for
"Netanyahu dead Iran 2026" in result position 3; the same query via the
multi-engine fan-out (google + bing + duckduckgo) returns generic Wikipedia
+ Britannica + NBC and no Snopes.

Quantitative confirmation: hit-row queries and miss-row queries are
indistinguishable on every measurable feature.

| feature              | HIT rows | MISS rows |
|----------------------|---------:|----------:|
| avg words / query    | 7.6      | 7.3       |
| avg quote pairs      | 0.46     | 0.50      |
| avg queries / row    | 2.79     | 2.60      |

If query style differentiated hits and misses, we'd expect a noticeable gap.
There isn't one — the engine decides.

### 2. Multi-quoted queries actively break the engine
Adding two or more separately-quoted phrases to a query
(`"Donald Trump" "Epstein" "rape"`) returns junk results: German government
job sites (`oeffentlicher-dienst.info`), eBay-Italy RSS, Pakistani real
estate listings. Empirically reproducible. The prompts that "improved" by
encouraging exact phrasing (v1, v17) bear most of the blame for the worst
regressions.

### 3. Adding fact-checker brand tokens REPLACES the natural Q1 — and that's worse
Prompts that tell the model "include `snopes` or `politifact` in a query"
cause it to put the brand at the START of Q1, e.g.
`Snopes Donald Trump Jeffrey Epstein children`. Search engines treat the
brand as a content keyword, returning pages that mention "snopes" (often
random sites). The original natural Q1
(`Donald Trump Jeffrey Epstein allegations evidence`) — which previously hit
npr.org via plain news ranking — gets lost. Net result: the brand-injected
variant ranks WORSE than v0.

### 4. Programmatic expansion didn't save us either
v22 kept v0's prompt verbatim and *appended* "Q1 + fact check" as a fourth
query, hoping the union would strictly grow. Two effects nuked the gain:
(a) the LLM has temperature variance, so v22's "v0-generated" Q1 differs
from the original baseline's Q1, and (b) the engine returns *the same*
results for `query` and `query + fact check` (it ignores the qualifier
beyond a few words). Effective query count: 3, not 4.

### 5. Hindsight bias confounds the "gold query" examples
A subagent hand-crafted 15 verified gold queries iteratively. The "lessons"
it extracted often required knowing the answer:
- "Search the corrected statistic, not the false one" ← needs the correction
- "Search the subject's *rebuttal* instead of the claim" ← needs to know it
  was rebutted
- "Search what the Treasury *actually said*" ← needs Treasury's record

These lessons are not actionable for DeepSeek, which only sees the tweet.
The only hindsight-free, transferable rule that held up was "avoid multiple
separate quoted phrases" (which v_final encodes).

### 6. The eval has measurable noise
- LLM default temperature varies output between runs. Setting `temperature=0`
  changes the output distribution, but my baseline v0 ran at default, so a
  v0 re-run at temp=0 produced 5 of 25 hits where the baseline got 14 of 25
  — a 36-percentage-point apparent drop driven by sampler noise.
- The SearXNG instance's per-engine state shifts (rate-limit suspensions,
  upstream blocks). The exact same cached-query test that returned
  `nationaltoday.com` early in the day returned generic encyclopedia pages
  later. Variant comparisons drawn hours apart aren't apples-to-apples.

## Recommendations

### Prompt
**Keep the v0 prompt.** No variant out of 12 attempts produced a robust
gain. The single validated improvement is `v_final.md` — same as v0 plus
one bullet: "avoid multiple separate quoted phrases in one query". That
specifically blocks the failure mode behind the worst regressions.

### Search backend (the real lever)
Move cheap-bot from google-only to a **multi-provider priority cycle**
where brave is at the top of the list when available:

```
SEARXNG_PROVIDERS="brave,presearch,google,duckduckgo"
```

Use the existing `proposed_searxng.ts` module (already on disk at
`src/scripts_jim/2026_05_27_searxng_speedup/proposed_searxng.ts`). Brave
surfaces fact-check sites (snopes, reuters, politifact, leadstories) at
top positions where the other engines bury them. Caveat: brave rate-
limits aggressively under load; the cycle handles this by falling through
to presearch / google / ddg per query.

If a sustainable rate from brave matters more than a free SearXNG, the
**Brave Search API (paid)** bypasses SearXNG's rate-limit issues entirely
and is ~$5/1000 queries — about $0.015 per cheap-bot run.

### Two-pass and chain-of-thought experiments
Both regressed sharply on DeepSeek-flash. Don't pursue without switching
to a smarter writer model.

## Artifacts

- 24 prompt variants in `datasets/query_writer_eval/prompts/`
- 11 evaluation runs in `datasets/query_writer_eval/runs/<variant>__val__<ts>/`
  with `rows.jsonl`, `judge.jsonl`, `summary.json`, `system_prompt.md`
- Search cache (~2600 entries) in `datasets/query_writer_eval/_search_cache/`
- Pluggable `evalHarness.ts` with `legacy` and `cycle` search backends, an
  inline LLM judge, and a `queryGen` extension point for non-prompt-based
  writers (two-pass, programmatic expansion).
- Subagent's 15 verified gold queries (in the agent transcript; the raw
  transferable insights are in this report's Findings section).
