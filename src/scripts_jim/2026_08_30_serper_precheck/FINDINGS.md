# Serper precheck (GOO-70) — exploration findings

Date: 2026-08-30

## Current state of the precheck

- The note-needed prefilter (`src/pipeline/prefilter/noteNeededPrefilter.ts`) is
  currently ON in production. It was disabled on 2026-08-25 (Brave monthly cap
  exhausted, SearXNG returning zero results from CI, prefilter failing closed)
  and re-enabled on 2026-08-26 with the per-run post cap back at 20
  (PRs #401 / #402, GOO-51).
- The chain per post: satire detector (LLM) → query writer (LLM, retried while
  it returns an empty list) → search per query → search analyzer (LLM) → note-
  needed judge (LLM). Everything runs on deepseek-v4-flash.
- Search goes through `src/pipeline/tool-calling/searxng.ts`: a ~460-line
  provider-cycling module (scraped google + scraped brave via a local SearXNG,
  brave-api as paid fallback) with a global 4s queue, 8s per-engine cooldowns,
  suspension tracking, Retry-After parsing, quota-402 handling. All of that
  machinery exists because the scraped engines rate-limit us and the Brave API
  has a monthly cap.
- The same module also serves the main bot's `web_search: "searxng"` A/B
  variants (kimi-k3-searxng at weight 2, plus zero-weight variants), not just
  the prefilter.

## Serper key status

- `SERPER_API_KEY` exists as a GitHub Actions repo secret (set 2026-01-07).
- The local env file has `SERPER_API_KEY=` **empty** — no local key, so local
  validation is blocked until the key lands there.
- No code references Serper anywhere yet.

## Decisions (Jim, 2026-09-02)

- Replace the **whole search layer** with Serper, not just the precheck's
  search. The simplification the ticket means is deleting the SearXNG
  machinery; the prefilter's LLM chain stays exactly as it is.
- Ship directly and watch submissions/day; no offline replay comparison first.
- Jim pasted the Serper key into the local env file; the CI secret already
  existed.

## Verification done

- One-off probe of the Serper API: HTTP 200, organic results with
  title/link/snippet(/date).
- `fetchSearchResults` smoke test through the new client: 8 results, formatted
  output identical in shape to the old formatter's.
- Full prefilter chain run locally on a fabricated false claim ("Eiffel Tower
  is 500m, tallest in Europe"): satire gate → query writer → Serper → search
  analyzer → judge returned `needsNote: true` with correct reasoning.

## Prior validation baseline

The old prefilter was validated offline against simple-bot's own decisions
(`src/scripts_jim/2026_06_06_deepseek_note_filter`): missed ~10% of posts the
bot would have noted, correctly filtered ~72% of the rest. Any Serper rebuild
should be compared against the same kind of baseline.
