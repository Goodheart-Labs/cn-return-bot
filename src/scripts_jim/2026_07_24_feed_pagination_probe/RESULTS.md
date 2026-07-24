# Feed pagination probe (2026-07-24)

Question: what does the eligible-posts endpoint return on the LAST page of a
feed walk — an error, an empty page, or something cleaner?

Run: `TEST_MODE=true bun --env-file=../cn-return-bot/.env run src/scripts_jim/2026_07_24_feed_pagination_probe/probe.ts`
(the local .env's X account is not admitted for `test_mode=false`; test mode
exercises the same pagination mechanics).

## Findings

- Pages return ~100 posts each; the walk ends with a **normal 200** carrying a
  partial page (11 posts) and a `meta` object with `result_count` but **no
  `next_token`**. No error, no empty final page, no sentinel value.
- This matches production logs: the small feed stops at 6 pages / 479 posts,
  well below any page cap — that stop can only be the missing `next_token`.
- Every response reports the rate budget in headers:
  `x-rate-limit-limit: 500` / `x-rate-limit-remaining` / `x-rate-limit-reset`
  (a 15-minute window). So a deep walk can stop proactively when
  `remaining` hits 0 instead of reacting to a 429.
- Pages can carry a partial `errors` array (e.g. a referenced tweet that was
  deleted) alongside a 200 — harmless, the parser already ignores it.

Consequence for `fetchEligiblePosts`: `!next_token → break` is the one true
end-of-feed signal; the header check stops before the request that would 429;
the try/catch salvage remains only for genuine mid-walk failures (timeout, 5xx).
