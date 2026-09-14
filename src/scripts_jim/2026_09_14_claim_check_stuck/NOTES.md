# Why the claim-check service reports itself as stuck (GOO-160, 2026-09-14)

Question: since 2026-09-13 both scheduled pipelines fail most of their runs with
"The claim-check service is stuck". What is going on? No fix in this folder,
only the explanation and the evidence.

## Short answer

The service is not dead. Four of its six worker slots are held by claim checks
that are each waiting on one model call to deepseek-v4-flash through OpenRouter.
That call is the note-needed prefilter, the cheap gate every X tweet passes
first. On the services machine, some of these calls take 30 to 47 minutes to
come back, and when they come back they are empty. Our retry wrapper then asks
again, up to four times in a row, so one tweet can hold a slot for two to three
hours. Nothing in the call path has a deadline: the OpenAI SDK's 10-minute
timeout only covers the wait for the response headers, and OpenRouter sends the
headers within a second and then keeps the connection open by sending
whitespace until the provider answers.

While the four slots are held, every new call waits behind them. The health
endpoint reports "4 in flight, oldest in flight 11000 s", the callers see an
age over the one-hour limit and fail the run, exactly as designed. The runs
that fail are the messenger. The wedge is upstream, in one model provider.

## The moving parts, in the order a call passes them

- **The two callers.** The X note writer (`create-notes-routine-dynamic`, every
  30 minutes at :18 and :48) and the feed walk (`everything-priority-feeds`,
  every 30 minutes at :03 and :33). Both run on GitHub Actions and both ask the
  claim-check service on the Hetzner machine (167.235.29.159, port 8787) to do
  the actual checking.
- **The queue in the service** (`src/service/workQueue.ts`). Six slots, two of
  them reserved for reader requests, so tweets and feed claims share four. A
  call that cannot start waits in memory. The health answer reports how many
  calls are in flight and waiting and how old the oldest of each is.
- **The stuck rule** (`queueIsStuck` in `src/service/client.ts`). A caller
  refuses to run when the oldest waiting or in-flight call is one hour old or
  older. The comment there anticipates exactly this shape: "the most likely
  wedge is every slot stuck on a network request that never returns".
- **The prefilter inside a tweet check** (`src/pipeline/prefilter/`). Satire
  gate, query writer, search analyzer and judge all run on
  `deepseek/deepseek-v4-flash` with reasoning effort high and no `max_tokens`.
- **The retry wrapper** (`callWithRetry` in `src/pipeline/llm/llm.ts`). A 200
  answer with empty content is retried up to three more times, with a backoff
  of 1, 2 and 4 seconds. That is the right thing for a fast empty answer and the
  wrong thing for a 40-minute one.
- **The OpenAI SDK timeout** (openai 5.23.2, `client.mjs` `fetchWithTimeout`).
  The 10-minute default wraps `fetch()` only and is cleared in `finally` the
  moment the headers arrive. Reading the body (`response.json()`) has no
  timeout.
- **OpenRouter's keep-alive.** For a non-streaming request OpenRouter answers
  with status 200 right away and pads the body with whitespace while the
  provider is working. Measured in `reproPrefilter.ts`: headers after 0.6 to
  1.4 s, then 11 to 33 leading whitespace characters before the JSON. So the
  SDK timeout never fires, no matter how long the provider takes.
- **What the callers do when they give up.** The feed worker aborts its own
  request after 30 minutes (`DEFAULT_CALL_TIMEOUT_MS`) and marks the claim
  `error`. The X run stops waiting at its soft deadline (22 minutes) and exits
  at 27; the next run sweeps the tweet's row as `failed / not_completed`. In
  both cases the service does not notice. `streamWhileWorking` in
  `src/service/serve.ts` says it explicitly: "The work itself carries on either
  way and its result is simply dropped." So a call the caller abandoned still
  holds its slot until the provider finally answers, and its cost is recorded
  nowhere, because the cost travels back in the response nobody reads.

## Evidence

### 1. The health timeline (`data/health_timeline.txt`)

Every run's health line from 2026-09-10 17:00 to 2026-09-14 08:48, both
workflows interleaved. Healthy days show "4 in flight, 6 waiting, oldest 500 s"
at :03 (the feed run looks while the :48 X run's ten tweets are still being
worked) and "0 in flight" at :18 and :48. From 2026-09-13 01:33 the in-flight
age grows by about 1800 s per 30-minute tick, which means the same calls stay in
flight across ticks:

```
2026-09-13T02:03  failure  4 in flight,  8 waiting, oldest in flight  4073s
2026-09-13T02:33  failure  3 in flight,  0 waiting, oldest in flight  5860s
2026-09-13T03:03  failure  2 in flight,  0 waiting, oldest in flight  7672s
2026-09-13T03:33  failure  2 in flight,  0 waiting, oldest in flight  9460s
2026-09-13T04:03  failure  2 in flight,  0 waiting, oldest in flight 11263s
2026-09-13T04:33  failure  1 in flight,  0 waiting, oldest in flight  9624s
2026-09-13T05:03  success  0 in flight,  0 waiting
```

The same shape repeats at 06:03, 10:33, 14:03, 20:03 on 09-13 and at 00:33 and
04:03 on 09-14. The waiting count peaks at 28 (09-13 21:03): each X run adds ten
tweets, each feed run adds up to six claims, and nothing leaves while the slots
are held.

### 2. The service journal on the machine (`data/box_journal_calls_and_deepseek.txt`)

`journalctl -u cn-claim-check` from 2026-09-12 20:00. The service process has
been up since the 17:28 UTC deploy on 09-13 (`NRestarts=0`), so this is not a
crash loop. During a stall the journal is almost silent; what it does print is
the retry wrapper, and the attempts of one call are 30 to 47 minutes apart:

```
20:31:18  [llm] Empty content (attempt 1/4, model: deepseek/deepseek-v4-flash). Retrying in 1000ms...
21:05:28  [llm] Empty content (attempt 2/4, ...). Retrying in 2000ms...
21:32:15  [llm] Empty content (attempt 3/4, ...). Retrying in 4000ms...
21:37:42  [claim-check] x tweet 2099147989080285235: rejected (prefilter)
```

and on 09-14:

```
04:40:13  attempt 1/4        04:40:17  attempt 1/4
05:27:17  attempt 2/4        05:28:44  attempt 2/4
06:11:00  attempt 3/4        06:11:30  attempt 3/4
```

The backoff between attempts is seconds. The 30 to 47 minutes are the provider
taking that long to return an empty answer.

Per day on the machine (`data/box_daily_counts.txt`; "finished" is calls that
completed, "empty" is empty-content retries):

| day | finished calls | empty-content retries |
|---|---|---|
| 09-10 | 863 | 23 |
| 09-11 | 853 | 21 |
| 09-12 | 726 | 10 |
| 09-13 | 368 | 67 |
| 09-14 (to 09:10) | 134 | 38 |

Throughput fell to under half while the empties tripled. The last stuck call of
the 09-14 morning episode ended at 07:37:10 with `ECONNRESET` while reading the
body ("The socket connection was closed unexpectedly", thrown from
`openai/internal/parse.mjs`), which is the body read, past the SDK timeout,
being cut by the far end.

### 3. The four tweets of one stall, in the database (`stuckTweets.ts`)

The X run at 19:48 on 09-13 sent tweets 2099147989080285235, 2099162010734809539,
2099156298004586994 and 2099153514065023232 at 19:52:33. The service finished
them at 21:37, 22:17, 22:17 and 22:19, between 1 h 45 min and 2 h 27 min later.
In `pipeline_runs` all four are `failed / not_completed`, "Run did not finish
(sweeper marked failed after 30 min)". Tweet 2099280096083271865 was sent at
04:22 on 09-14 and ended at 07:37, 3 h 15 min later. None of these tweets is
retried: the next run skips everything already in the `tweets` table.

### 4. Reproduction from the dev box (`reproPrefilter.ts`, `reproMany.ts`)

Running the satire gate and query writer on the same three tweets with the
production settings, 46 calls in total, every call returned in 1 to 10 seconds.
OpenRouter routed them to nine different providers (OpenInference most often,
then DigitalOcean, DeepInfra, Wafer, StreamLake, Parasail, NextBit, Mancer 2,
Venice, AtlasCloud). So the slow-and-empty answers come from a subset of
providers at certain times, not from the prompt or the model as such. I did
not catch a slow one in the window I tried, so the provider is not named here.
The endpoint listing (`data/openrouter_deepseek_v4_flash_endpoints.json`) has 17
providers; several allow up to 943,718 completion tokens, and we send no
`max_tokens`, so a provider whose reasoning loops can run for a very long time
before it gives up and returns nothing.

The same "empty content from some providers" behaviour was documented in July
(`src/scripts_jim/2026_07_02_query_writer_empty/NOTES.md`, mechanism 2: a
provider that emits no reasoning). What is new since 09-13 is that the empty
answers take up to 47 minutes to arrive instead of seconds.

### 5. What it cost (`damage.ts`)

X runs recorded as `failed / not_completed` per day (UTC): 10 on 09-12, 93 on
09-13, 37 on 09-14 by 09:00. Notes submitted: 37 on 09-12, 15 on 09-13, 5 on
09-14 by 09:00. Feed claims checked (note or no_note): 233 on 09-11, 24 on
09-13, 9 on 09-14 by 09:00. The feed side also has three claims marked
`error: The operation timed out.` on 09-13.

The `[max-posts]` line in the X runs still says "no binding writing-limit hit",
so the drop in submissions is entirely the pipeline not finishing tweets.

## Two things seen on the way that are not this bug

- `[noteEvaluationFilter] Error evaluating note: Request failed with status
  code 403`, 280 times in the journal. Every candidate note on the machine
  fails X's evaluate-note scoring and is let through unscored ("Evaluation API
  failed, skipping"). Either the X keys in `/etc/cn-return-bot/service.env` are
  wrong or X refuses the machine's IP. This has been the case since the
  cutover and deserves its own ticket.
- `[gemini] free key out of quota`, 669 times. The free-tier Gemini key is
  exhausted most of the time and the code falls back to the paid key, which is
  expected behaviour, just noisy.

## What a fix would have to do (for when Jim says go)

Not implemented. Listed so the options are on the table.

1. A deadline on the body read of every OpenRouter call, either by streaming
   (then the SDK timeout applies between chunks) or by wrapping the whole call
   in `AbortSignal.timeout`. This is the one that removes the wedge whatever
   the provider does.
2. `max_tokens` on the prefilter calls, so a provider whose reasoning loops
   stops within minutes instead of tens of minutes.
3. Exclude the slow providers for deepseek-v4-flash with OpenRouter's
   `provider.ignore` or `provider.order`, once the OpenRouter activity page
   for the machine's key names them (the page lists generation time and
   provider per request; the code does not log the generation id).
4. Do not retry an empty answer that took longer than a healthy call, or cap
   the total time the retry loop may spend.
5. Let the service drop a call whose caller has hung up, so abandoned calls
   stop holding slots. That is the caller-side timeout reaching the service,
   which today it never does.
