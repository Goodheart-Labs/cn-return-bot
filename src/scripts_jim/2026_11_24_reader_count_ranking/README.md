# Reader count in the post list's ranking (GOO-868)

Jim's question: if the post list ranked a post by its creator's rank plus the
number of different readers who opened it, instead of the fixed reader bars of
migration 183 and PR #772, would the posts we check get more readers?

1. `queries/*.sql` are run on production with `sql.py` (management API, read
   only). They return aggregates only: per page, how many different readers
   first opened it in each minute. No reader hash leaves the database. The
   answers go to `data/`, which git ignores.
2. `replay.py` replays 2026-11-19 08:00 to 11-23 00:00 UTC under each order
   and prints the table. `details.py` breaks the main comparison down by day
   and by post, and measures how large creator ranks and reader counts are.

```bash
for q in slots items first_visits projects creator_scores; do
  uv run src/scripts_jim/2026_11_24_reader_count_ranking/sql.py src/scripts_jim/2026_11_24_reader_count_ranking/data/$q.json \
    < src/scripts_jim/2026_11_24_reader_count_ranking/queries/$q.sql
done
uv run src/scripts_jim/2026_11_24_reader_count_ranking/replay.py    # about 4 minutes
uv run src/scripts_jim/2026_11_24_reader_count_ranking/details.py
```
