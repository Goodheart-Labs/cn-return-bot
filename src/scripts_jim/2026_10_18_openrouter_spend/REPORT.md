# OpenRouter spend, October 2026 (GOO-461)

Data as of 2026-10-18 04:15 UTC. All times are UTC.

## Summary

- **What hit the limit.** OpenRouter is the service that forwards our model
  calls to the model makers and bills us for them. Each OpenRouter API key can
  carry a spending limit. Our production key (its hash starts `3cec2aea`) has a
  limit of **$1,500 per calendar month**. It reached the limit on **Oct 16 at
  08:54**. Since then OpenRouter refuses every call on it with "Key limit
  exceeded (monthly limit)". It shows $1,503.25 used, because calls already
  running when the limit hit were still billed. The limit resets on
  **Nov 1 at 00:00**.
- **The X bot and Common Notes share this one key.** Both products make their
  model calls on the services box, which has a single `OPENROUTER_API_KEY`.
  Every refused call in the box's log, from both products, names the same key.
- **When the money went.** There was no single spike. Spending was steady at
  about **$97 a day** from Oct 1 (between $66 and $134). A $1,500 monthly limit
  allows about $48 a day, so the key was always going to run out in the middle
  of the month.
- **On what.** One item stands out. The X bot's search step on **Claude Opus 5**
  cost **$740**, half of the month's total, at 32 cents per search. The X bot
  as a whole spent 72% of the money. Common Notes spent 28%.
- **Is it normal?** The spend matches what the code is set up to do. Our own
  cost records add up to $1,498 by 08:00 on Oct 16, and OpenRouter cut the key
  off at $1,500.87 an hour later. The two agree to within $3, so no one else is
  using the key and no loop is running. The real problem is the rate: the
  limit fits about half of what the current settings spend.
- **What is broken now.** Neither product has written a note since Oct 16
  08:54. The Common Notes feed run starts every 3 minutes and fails within
  seconds: 1,177 failed runs and 397 posts marked as errors so far. The X bot
  still pays xAI (Grok's maker, billed directly, not through OpenRouter) about
  $45 a day to look up tweet replies for tweets it then cannot check.
- **Your decision.** Raise the key's limit in the OpenRouter dashboard, or
  wait until Nov 1. At the current rate, the rest of October needs about
  $1,500 more, so a limit of about $3,000. Separately, decide whether Opus 5
  should keep 45% of the X bot's search traffic. The options are below.

## What the terms mean

- **Key limit and reset.** A limit is a dollar ceiling on one key. With a
  monthly reset, the count starts again at 00:00 UTC on the first day of each
  month. Other keys on the account are not affected.
- **Management key.** This is a special OpenRouter key that cannot call models.
  It can list the account's keys and read the account's activity per day, model
  and key. OpenRouter's docs call it a management key, and used to call it a
  provisioning key.
- **Tokens.** Models bill by tokens, which are word pieces of about four
  characters. Input tokens are what we send, and output tokens are what the
  model writes, including its hidden reasoning.
- **A/B arm.** The X bot splits its traffic between several configurations at
  random, to compare them. Each configuration is an arm, and its weight is its
  share of the traffic.

## Where the numbers come from

- **The limit, the time it was hit, and the key's identity** come from
  OpenRouter's own error message. The services box's systemd journal (Linux's
  built-in log store, read with `journalctl` over SSH) records that message on
  every refused call.
- **The breakdowns by day and model** come from our own cost records. Both
  pipelines write the cost of every model call into their run rows
  (`pipeline_runs` for the X bot, `everything_pipeline_runs` for Common
  Notes). `db_spend.py` labels each call with the company that billed it,
  following the code on main, and keeps only the OpenRouter calls for the
  tables below. The CSV files are in `results/`.
- **OpenRouter's own breakdown is still missing.** The management key in
  the env file (`OPENROUTER_MGMT_KEY`) is rejected as "Invalid API key". It has
  been dead since at least September. With a new key, `fetch.py` downloads
  OpenRouter's own numbers: every key on the account with its limit and
  monthly usage, plus spend per day, per hour, per model and per key for the
  last 30 days. It also shows any key other than `3cec2aea`, for example the
  one in the GitHub secret, if that is a different key.

## When: OpenRouter spend per day

The key's spend per UTC day, from our records, with the running total for the
month.

```
Day     CN     X bot  Total  Month
Oct 01   20     62     82     82
Oct 02   23     57     80    162
Oct 03   22     44     66    227
Oct 04   24     58     82    309
Oct 05   21     84    105    414
Oct 06   20     72     91    505
Oct 07   25     64     90    595
Oct 08   30     73    103    698
Oct 09   23     76     99    797
Oct 10   35     69    104    901
Oct 11   31     72    102   1004
Oct 12   27     81    109   1112
Oct 13   37     97    134   1246
Oct 14   37     69    105   1351
Oct 15   38     69    107   1459
Oct 16   11     29     40   1498  <- limit, 08:54
Oct 17    0      0      0   1498
```

CN is Common Notes. In US dollars, rounded.

There was no single spike. Oct 13 was the busiest day, at $134. The X bot
searched more tweets that day, and Common Notes moved to the more expensive
GPT-6 Luna (see below). In the last hours before the limit, about $5 an hour
went out. The running total stood at $1,491 after the 05:00 hour, $1,496
after 06:00 and $1,498 after 07:00.

How the rate got here, from the second half of September:

- **Sep 17 and 18.** Claude Opus 5 got 45% of the X bot's search traffic
  (commit 272a37e8, "Put 80% of search and writer traffic on the proven
  arms"). The key's spend rose from about $10 to $50 to $60 a day.
- **Sep 23.** The X bot started checking about 70% more tweets per run.
  It still ran 48 times a day, but the "large" and "xl" feeds (X's lists of
  posts that may need a note) sent more posts. This came the day after #504
  merged and the feeds recovered from their Sep 20 and 21 outage. The exact
  cause is not established. Spend rose to about $80 a day.
- **Sep 28 and 29.** Common Notes moved its research step onto Muse's search
  through OpenRouter (commit a070e47c). Its share of the key went from about
  $4 to $16 a day.
- **Oct 7 to 15.** Common Notes grew from about $20 to $37 a day. It
  checked more claims, and from Oct 13 it ran on GPT-6 Luna, whose searches
  cost 3 cents against Muse's 1.7.

## On which models (Oct 1 to 16)

```
What                     Cost  Calls  Per call
X bot search Opus 5      $740   2345   $0.32
X bot search Sonnet 5    $226   1333   $0.17
CN search Muse           $199  11464   $0.017
CN extract, rate, write  $137  24855   $0.006
X bot other steps        $109  77473   $0.001
CN search GPT-6 Luna      $86   2873   $0.030
X bot search GLM 5.3       $1    384   $0.002
Total                   $1498
```

"CN extract, rate, write" is every Common Notes step other than search. All of
them run on Muse until Oct 13 and on GPT-6 Luna after that. "X bot other
steps" are the prefilters, topic filter, note writer, verifier and image
descriptions. Our records keep the cost per step but not the tokens per model
for every step, so token counts per model have to wait for OpenRouter's data.
The day-by-model table is `results/db_openrouter_day_by_model.csv`.

The X bot's other search arms (Grok 4.6 at weight 7, Gemini 3 Flash at 10,
Gemini 3.8 Flash at 6) call xAI and Google directly with our own keys. They
cost $162 this month, but not on OpenRouter.

## Why the daily cap did not stop it

The daily spend cap in `src/everything/spendCap.ts` ($50 a day, $40 of it for
the feed) applies only to Common Notes, and Common Notes stayed under it: at
most $38 a day on OpenRouter. The X bot has no money cap at all, only time
limits per run, and it spent about 72% of the key's money. So no cap of ours
was in a position to stop the key from running out.

## Is it normal?

- **No leak.** Our records add up to $1,498 at 08:00 on Oct 16, and OpenRouter
  stopped the key at $1,500.87 at 08:54. Traffic we did not make would show up
  as a gap between the two numbers, and there is none.
- **No runaway loop.** No day stands out. Every call in our records belongs to
  a pipeline step that the code makes on purpose.
- **Not in line with the budget.** The key's limit allows about $48 a day.
  The settings on main spend about $97 a day. Half of that is Opus 5 search
  in the X bot.
- **One cost that does look abnormal is not on OpenRouter.** The X bot asks
  Grok on xAI's own API for representative replies to each tweet. From 11:00
  on Sep 28, xAI billed about 9 cents per lookup instead of 1.6, with the same
  tokens and no code change on our side. That cost about $85 a day,
  $1,375 so far in October, on xAI's bill. It still runs during the outage.

## What the outage does right now

- **Common Notes.** No new notes since Oct 16 08:54. The feed run's alarm
  thinks the pipeline is behind, so it starts a run every 3 minutes. Each run
  enqueues one post, fails within seconds when extraction is refused, and goes
  red. That is 1,177 failed runs and 397 posts marked `error` with "Key limit
  exceeded" so far. Errored posts are retried twice, at least 6 hours
  apart, so most of these will run out of retries before the key works again.
  They will need to be requeued by hand. Reader requests and passage questions
  would fail the same way, but none came in. Reading existing notes on the
  website and in the extension still works, because that needs only the
  database.
- **X bot.** It still runs every 30 minutes and takes 960 tweets a day. Each
  tweet fails at its first OpenRouter call. No notes have been written or
  submitted since the limit. Before failing, each tweet still costs one Grok
  reply lookup on xAI: $87 since Oct 16.

## Options

1. **Raise the limit on key `3cec2aea`** in the OpenRouter dashboard
   (Settings, then API keys). At about $97 a day, the rest of October needs
   about $1,500, so a limit of about $3,000. Both products resume within
   minutes, without a deploy. This is your decision. I changed nothing. The
   management API can also do it, with
   `PATCH https://openrouter.ai/api/v1/keys/<hash>` and the body
   `{"limit": 3000}`, but I would only run that on your instruction.
2. **Lower the X bot's search cost.** Opus 5 costs $0.32 per search and
   Sonnet 5 $0.17. Moving Opus 5's 45% weight to Sonnet 5 would have saved
   about $340 this month. Whether it costs helpful notes is the A/B question.
3. **Give each product its own key and limit.** Then a busy X bot cannot
   stop Common Notes, and each budget can be seen on its own. The services
   box would need a second key variable, and the code would pick the key by
   product. This is a small code change.
4. **A fallback key** would only move the same spending to a second key. It
   does not lower spend, so I would not do it on its own.
5. **Lowering Common Notes' daily cap** would not help. Common Notes is only
   28% of the spend.

Whatever you choose, once the key works again, requeue the 397 posts that
failed on the key limit.

## Files

- `db_spend.py`: our own cost records, labelled by billing company. Writes
  `results/*.csv`.
- `fetch.py`: OpenRouter's own numbers through the management key. Writes
  `raw/` (gitignored). It is waiting for a working `OPENROUTER_MGMT_KEY`.
