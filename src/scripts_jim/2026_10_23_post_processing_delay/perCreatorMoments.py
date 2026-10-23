# /// script
# dependencies = []
# ///
"""Per creator, over their 10 most recently visited posts: the number of posts
and the sum and sum of squares of distinct readers per post, and of their logarithms. Only these counts
leave the database, never visit rows. Saved to perCreatorMoments.json for
shrunkScoreNormal.ts (GOO-549)."""
import json, urllib.request
from pathlib import Path

SQL = """
with page as (
  select lower(rtrim(feed_url, '/')) as creator, page_url,
         count(distinct reader_hash) as readers, max(visited_at) as last_visit
  from everything_link_visits
  where reader_hash is not null and feed_url is not null
  group by 1, 2
), recent as (
  select *, row_number() over (partition by creator order by last_visit desc, page_url) as recency from page
)
select creator, count(*) as n, sum(readers) as s, sum(readers * readers) as ss, sum(ln(readers)) as ls, sum(ln(readers) ^ 2) as lss
from recent where recency <= 10 group by creator
"""
token = Path.home().joinpath(".supabase/access-token").read_text().strip()
request = urllib.request.Request(
    "https://api.supabase.com/v1/projects/ugytvkevhsmcpunfvncw/database/query",
    data=json.dumps({"query": SQL}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "curl/8.0"},
)
rows = json.load(urllib.request.urlopen(request))
Path(__file__).with_name("perCreatorMoments.json").write_text(json.dumps(rows))
print(len(rows), "creators")
