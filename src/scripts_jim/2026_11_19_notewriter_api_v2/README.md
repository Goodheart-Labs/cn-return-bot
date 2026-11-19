# Notewriter API v2 (GOO-791)

Tests and numbers for migration 184, run on 2026-11-19.

- `prodState.ts` reads production's notewriters, assignments and item counts (read-only).
- `http_test.sh` calls the API through PostgREST 14.5, the version production runs, against the throwaway Postgres of `migrations/184_notewriter_api.fixture.sql`. Results: every error maps to its HTTP status (401 no or wrong key, 403 not yours or switched off, 404 no such post, 409 ended or own passage, 429 a limit, 400 a broken rule). 20 notewriters reserving one post at once with at_most 1: 1 reserved, 19 taken. v1's next_post and a v2 reserve of the same post at the same moment, 10 rounds: never two first places.
- `bench.sql` benchmarks the listing at 20 times production's 6,294 posts: 126,000 posts, 4,926 listed, 190 requested. A page of 50 took 1 to 4 ms, the whole notewriter_api_posts call about 10 ms, v1's next_post 9 ms, a reserve 6 ms, cn-walk's tidy-up 8 ms. A page deep in the list is one range scan of the list index that reads only the 50 rows it returns (0.7 ms).
