# Finding posts about articles that go viral in Nathan's crowd (GOO-289)

Investigation from 2026-10-01 and 2026-10-02. The goal was to notice when a post
on X about an article or blog post gets a lot of traction among Nathan Young's
crowd: AI safety, effective altruism, forecasting, rationalists, tpot, progress
studies, and US and UK politics. The result is the daily job in
`src/production/postTrendingPosts.ts`, which posts such posts to Slack's
#trending-posts.

Every script here saves its raw responses in `data/`. That folder is not
committed, because the repository is public and the responses quote other
people's posts. Costs below are what the APIs billed.

## The question, split into parts

"A post about an article gets a lot of traction in these crowds" has three
parts, and each data source covers a different subset of them.

1. Traction: the post is big, with many likes, reposts and quotes.
2. In these crowds: the people engaging are the crowd, not the general public.
3. An article: the post links to or discusses something we could fact-check.

The hard part is the second one. X's public API never says who liked a post
without charging per liker. So every method measures the crowd indirectly.

## The options and how they work

### X API, pay-per-use

X's developer API now charges per item returned. A post costs $0.005, a user
$0.01, a News story $0.005. Some endpoints charge per request instead: a count
costs $0.005 and a trends request $0.01. The only keys that still work are Jim's
own app (`X_JIMMAAR1_*`). The notewriter keys in GitHub are refused, because
that app is not attached to an X "Project", the container an app must belong to
before it may use version 2 of the API. Nathan's keys answered 401.

- **News** (`/2/news/search`, `/2/news/{id}`). X has Grok group posts into
  "stories". A story has a headline, a summary, topics, and the ids of about 10
  posts in its cluster. It has no links.
- **Trends** (`/2/trends/by/woeid/{id}` and `/2/users/personalized_trends`).
  Trend names with post counts. The personalized version needs X Premium on the
  calling account.
- **Search** (`/2/tweets/search/recent`, the last 7 days). Takes X's query
  language. The filters ("operators") that matter here all work on our plan:
  `from:` limits to named accounts, `list:` to the members of an X List, and
  `min_likes:` drops small posts on X's side, so we do not pay for them. Each
  post comes back with its links resolved to the final article address and the
  article's title, and with its like, repost and quote counts.
- **Counts** (`/2/tweets/counts/recent`). Same query language as search, but it
  returns only how many posts matched, per minute, hour or day. One request
  costs $0.005 no matter how many posts match. It measures, it cannot discover.
- **The X Activity API**. A push feed: X calls a web address we host when
  something happens. The event `news.new` would push every new News story, but
  it is for X's Enterprise and Partner tiers only. Events such as
  `post.quote.create` (someone quoted a given account's post) are open to us, at
  $0.005 per event.

### Grok's `x_search` tool

xAI's Responses API takes a prompt and a list of tools. With `x_search` on, the
model writes its own searches over X's internal index (keyword searches,
searches by meaning, user lookups, whole threads). xAI runs them on its servers,
feeds the results back to the model, which may search again, and then the model
answers. The settings are `from_date` and `to_date` (whole days),
`allowed_x_handles` or `excluded_x_handles` (at most 20 accounts), and whether
to look at images and videos. Billing is per token plus $5 per 1,000 posts the
searches return. It can judge content and knows who people are, which no X
endpoint can. It cannot be made repeatable, and we cannot see its searches.

### Other options considered and not tested

Third-party resellers of X data (twitterapi.io, SocialData) sell posts at about
$0.15 to $0.20 per 1,000, about 30 times cheaper than X, but they need a new
account and may vanish. X Premium's "Top Articles" tab does exactly what we want
for the people an account follows, but it has no API.

## The experiments, in order

### X API

1. **Cheap probes** (`01_cheap_probes.ts`). News search for three crowd topics
   returned mainstream stories, in Danish because of the app's settings.
   Worldwide trends were hashtags and sports. Personalized trends refused us
   for lack of Premium.
2. **Search operators** (`02_search_operators.ts`). `from:`, `list:` and
   `min_likes:` all work. Links come back resolved and titled. X Articles (long
   posts written on X itself) show up as `x.com/i/article/<id>` links.
3. **Volume** (`03_volume.ts`, `04_follow_sample_volume.ts`). Nathan follows
   3,893 accounts. Jim's 72 follows post, per account per day, 0.14 original
   posts with a link, 1.9 quotes, 1.8 reposts and 8 posts of any kind. Reading
   everything that can point at an article costs about $0.03 per crowd account
   per day once the quoted and reposted posts are counted too. All of Nathan's
   follows would cost about $100 a day. On 2026-10-01 a 200-account sample of
   Nathan's follows ($2) used up the app's remaining credit.
4. **Backtest of "distinct crowd sharers per article"**
   (`09_backtest_share_count.ts`, $2.30). One day of Jim's 72 follows pointed at
   35 articles, and no article was shared by more than 2 of them. The crowd was
   far too small for this count to separate anything, and a crowd large enough
   would cost too much.
5. **Ranking by the linking post's engagement instead**
   (`10_engagement_signal.ts`, free on saved data). The top results were
   mainstream politics that one followed account had reposted. Engagement shows
   a post is big, not that the crowd cares.
6. **News, looked at properly after Jim's "Today's News" panel showed exactly
   the right kind of story** (`06` and `07`). News search is not personalized:
   as the app and as Jim's user it returns the same stories, only in a different
   language. Its query is a loose word match ranked by size. "Scott Alexander"
   returned stories about other people called Scott.
7. **The panel's story by id** (`11`, `12`, `13`). Lookup by id works, but only
   with the app's token; with the user's token it answers 503. The story was one
   post by @slatestarcodex, with no link and 274 quotes, plus the quote posts
   reacting to it. So a News story is roughly "a post and the quotes it draws".
   Search did not return it in its top 20 even for "Scott Alexander" within 24
   hours, so News cannot find niche stories, even though it holds them.

Spend on X over both days: about $6.

### Grok

8. **Topic search on `grok-4.3`** (`05_grok_x_search.ts`, $0.31). Five real,
   fresh crowd posts, chosen by topic rather than by traction. Limited to 20
   crowd accounts, it found nothing.
9. **One call per crowd on `grok-4.7`** (`14_grok_viral_per_crowd.ts`,
   $14.68 for 8 calls). Each call ran 25 to 57 searches, which is why it was so
   expensive. The picks were the right kind of thing. The rationalist call found
   the Scott Alexander post from Jim's panel with almost exact numbers.
10. **Verification against X** (`15_verify_grok_posts.ts`). All 62 posts exist,
    are from the last 48 hours, and have like counts within 20% of X's own. Only
    about 9 of them were about an article, because the prompt did not ask for
    that.
11. **One "Nathan Young's crowd" prompt** (`16_grok_nathan_crowd.ts`). On
    `grok-4.7` ($2.96) it drifted almost entirely to AI safety. On `grok-4.3`
    ($0.27) it went shallower but returned mostly posts with articles. All 15
    posts were real.
12. **Posts about one given article** (`17_grok_posts_about_article.ts`).
    `grok-4.7` found the largest posts about a given article for about $0.50.
    `grok-4.3` cost a few cents but missed one article entirely. This answers a
    question we do not have, because we never start from a known article.
13. **Why the first dry run of the job found nothing**
    (`19_empty_results_probe.ts`). With `from_date` equal to `to_date`, the
    searches fetch no posts at all, although xAI's docs call both dates
    inclusive. With `to_date` set to the next day, every post returned is from
    the first day. So `to_date` behaves as the start of that day.

Spend on Grok: about $20.

## What we built and why

Jim chose Grok: one `grok-4.3` call per topic per day, each asking for the posts
of the previous UTC day that went viral in Nathan Young's crowd within that topic
and that reference or are about an article or blog post. The answers go to
#trending-posts. The job requests no Common Notes, because too many of the posts
would be false positives.

- `grok-4.3` because it costs cents per call, against about $2 for `grok-4.7`.
  The first full dry run cost $0.66 for all 8 topics.
- One call per topic because a single prompt for the whole crowd drifts to one
  topic.
- Exactly one finished UTC day per run, so no post can appear twice and the job
  needs no record of what it posted. It runs at noon UTC, so a post from late
  the previous day has had at least 12 hours.
- At most 5 posts per topic, and the prompt says fewer or none is fine, so Grok
  is not pushed to fill the list.
