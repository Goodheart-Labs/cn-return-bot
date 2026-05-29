# Query-writer hill-climbing log

Dataset: `datasets/query_writer_eval/` — built from the 289 `needs_note=yes` rows
in `big_eval/dataset.jsonl` that have at least one non-social reference URL.

| Split | n | source |
|---|---:|---|
| val | 59 | hill-climbing target |
| test | 78 | sealed until final eval |
| few_shot_pool | 30 | reserved for prompt demonstrations |
| train | 122 | unused (reserved for tuning) |

Search backend: SearXNG (multi-engine: google + bing + duckduckgo, language=en).
Search results cached on disk keyed by query.

## Metrics

- `JUDGE %` — fraction of rows where a DeepSeek judge says the search results
  contain at least one URL sufficient to support the reference correction.
  PRIMARY metric.
- `domain %` — fraction with any reference-domain match in results.
- `url %` — fraction with an exact normalized URL match in results.

## Iterations

| iter | variant | JUDGE % | Δ | domain % | url % | avg_q | empty | notes |
|---|---|---:|---:|---:|---:|---:|---:|---|

(populated after each run)

## Diagnoses

(populated after each iteration)
