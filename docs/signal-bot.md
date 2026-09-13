# Signal Community Notes bot

People paste a tweet, get an access/eligibility check and a theoretical sourced
draft, discuss or rewrite it, then say **yes post** to submit the current version.
Every member of the configured group can approve a note. The language model has
no posting tool; an exact human command enters the submission code.

## Conversation

```text
Person: https://x.com/example/status/1234567890123456789
Bot:    #1 · 1234567890123456789
        I can read this tweet. Submission eligibility is unconfirmed…
Bot:    #1 · 1234567890123456789
        Proposed note · v1

        [note text and source URLs]

Person: [reply to bot] Does the source actually establish the date?
Bot:    [discussion; the draft stays unchanged]
Person: #1 Rewrite it using this primary source: https://example.org/report
Bot:    #1 … Proposed note · v2 …
Person: [reply to v2] yes post
Bot:    Submitted v2: [Community Note link]
```

Use Signal replies or `#1`, `#2`, etc. to identify the conversation. When exactly
one conversation is open, unquoted messages can refer to it. With several open
conversations the bot asks which tweet you mean. Send one tweet per message.

- `yes post`: submits the current displayed version, including its source order.
  Plain `yes` works only as a reply to a message displaying the current draft.
  Replies to an older version and approvals sent before a draft was displayed
  are rejected. Approvals are bound to the displayed version at receipt, so a
  queued rewrite cannot substitute a new version even if a sender's clock is
  ahead. That binding survives restarts. Editing a draft never silently reuses
  a previous approval.
- `draft` or `status`: shows the current draft again.
- `draft: <exact note body> <source URL> ...`: saves a human rewrite verbatim.
  With no URLs, it retains the current sources. Put URLs at the end, separated
  by single spaces; unsupported formatting is rejected instead of normalized.
- Ordinary questions discuss the evidence. Requests such as “rewrite”, “use
  this source”, or “make it shorter” can produce a new version. Up to three
  supplied source pages are read per message; blocked/login-only pages are
  reported as unread, not treated as verified evidence.
- `cancel` or `withdraw`: removes the current draft.
- After a failed check, repeat your request or say `retry`. A known X rejection
  keeps the draft available for another explicit approval. An uncertain X
  outcome blocks retries until reconciled.

Tweet readability is separate from permission to write a note. Inspection uses
the ordinary X lookup and one bounded page of the eligible-posts feed. A match
is positive evidence; absence means **unconfirmed**, not ineligible. X makes the
final decision on submission. Drafting does not spend note-writing slots. A
draft can be shown with a failed source-check warning for human review; posting
does not ask an LLM to rewrite the approved text or apply automatic feed-ranking
thresholds. Final text/source/length validation and X's submission rules still
apply.

## Setup

The worker uses Bun and the repository's existing X/LLM credentials and media
tools. Run it on a persistent host with the same dependencies as the production
pipeline (including ffmpeg, yt-dlp, and Playwright's bundled Chromium for media
and source fallbacks). Do not configure the real Google Chrome application.

1. Use an existing linked Signal account, or a separate account for the bot.
   The gym alarm already has a working bridge and Nathan's account linked on
   its server; deployment details are in `../signal-gym-alarm/laptop-alarm.sh`
   and `../admin/logseq/pages/Signal gym alarm.md`. To reuse a personal account,
   set `SIGNAL_ACCEPT_SELF_MESSAGES=true`: the bot accepts group messages synced
   from your phone or other linked devices. It records its own output before
   sending and ignores exact echoes, including after a restart or lost HTTP
   response. The setting defaults to false for dedicated bot accounts.
2. **If reusing the gym bridge**, keep its existing container and linked device.
   Both watchers can subscribe to its receive websocket independently. Run the
   notes worker on that host with `SIGNAL_API_URL=http://127.0.0.1:8080`, or use
   an SSH tunnel from another machine and point at the forwarded local port.
   Select the notes group's ID explicitly; the gym alarm's `TARGET_GROUP_ID`
   identifies the gym chat and is not a default for the notes bot.

   **For a new bridge only**, start it with:

   ```sh
   docker compose -f scripts/signal-bot.compose.yml up -d
   ```

   On the bridge host, visit
   `http://127.0.0.1:8080/v1/qrcodelink?device_name=cn-return-bot` and scan its QR
   from the chosen account's Signal **Settings → Linked devices**. The supplied
   compose file binds the unauthenticated bridge API to localhost and persists
   its account state in a Docker volume. An existing compatible bridge can also
   be used; set `SIGNAL_API_URL` accordingly.
3. Set the `SIGNAL_*` entries from `.env.example`. `SIGNAL_NUMBER` is the bot's
   E.164 number. `SIGNAL_GROUP_ID` can be the internal base64 group ID or the
   REST `group.…` ID returned by
   `GET /v1/groups/<bot-number>`. `SIGNAL_BOT_UUID` is optional and provides
   another way to filter the bot's own messages.
4. Set the standard `X_*` and `OPENROUTER_API_KEY` credentials;
   retain the normal optional media/model credentials used by the pipeline.
   Signal uses Anthropic native web search through OpenRouter, so this worker
   does not require a Serper key. The scheduled pipeline keeps its own search configuration.
   For live submissions, **the Signal worker and scheduled pipeline must use
   the same X note-writer account and Supabase database**. The quota ledger
   currently represents that one account.
5. Try the group interaction with X submissions disabled:

   ```sh
   bun src/signal-bot/main.ts --dry-run
   ```

   This still makes paid research calls and sends replies to the configured
   Signal group. `yes post` reports what would be submitted without writing to
   X or creating a quota claim. Dry-run state uses a separate database.
6. Before live startup, apply
   `migrations/093_signal_submission_reserve.sql` through the normal database
   migration process. Deploy the updated scheduled pipeline and let any run
   using the old submission code finish. Then start:

   ```sh
   bun src/signal-bot/main.ts
   ```

   The live worker checks the quota RPC before connecting. A missing migration
   prevents startup. All updated submission routes fail closed if quota
   admission is unavailable. Run one worker per state file, with a process
   supervisor if unattended; SIGINT/SIGTERM drain accepted work before closing.

`bun src/signal-bot/main.ts --help` is entirely local and makes no API calls. The bridge
image is pinned to [release 0.100](https://github.com/bbernhard/signal-cli-rest-api/releases/tag/0.100).
Signal automation uses the unofficial
[signal-cli-rest-api bridge](https://github.com/bbernhard/signal-cli-rest-api);
its [API examples](https://github.com/bbernhard/signal-cli-rest-api/blob/master/doc/EXAMPLES.md)
cover linking and groups. Keep the bridge compatible with Signal when upgrading.

## Three-slot reserve

Migration 093 enforces admission under one database transaction lock across
scheduled and Signal workers:

```text
remaining = max(0, estimated cap − submissions in rolling 24h − unresolved claims)
automatic may claim only when remaining > 3
Signal may claim when remaining > 0, or attempt when the cap is unknown
```

This is rolling spare capacity, not three notes per calendar day. People can
use the reserve; it refills as capacity returns. X may lower its cap without
notice, so three is a target, not a guaranteed allowance. Unknown capacity
blocks automatic submissions until an estimate is established. With a known
cap of three or fewer, all available slots are kept for Signal. The scheduled
pipeline checks capacity before paid generation or cap probing and skips when
the reserve binds, the cap is unknown, or the check fails. The final atomic
claim still decides whether a completed note can submit. The reserve can
also slow discovery of a raised cap, because automatic submissions stop before
the old “keep submitting until rejected” exploration reaches the limit. No
automatic probe bypasses the reserve.

The shared ledger retains claims until the X outcome is recorded. Confirmed
claims cover accepted notes even if inserting their `notes` row fails, and are
not counted twice once that row exists. Same-tweet claims prevent duplicate
submission across Signal and cron. Only Supabase's service role can read or
change claims or invoke their RPCs.

## Persistence and recovery

`SIGNAL_STATE_PATH` defaults to `output/signal-bot.sqlite` (or
`output/signal-bot-dry-run.sqlite`). It contains private group discussion,
numbered drafts, incoming-message deduplication, and human approvals. Keep the
file, its WAL, and the bridge volume on persistent storage. Scope checking
prevents accidentally reusing a state file for another group or run mode.
Shared pipeline logs contain the approved note and version, without copying
group conversation or member identities.

When sharing a personal account, the database also holds SHA-256 hashes of bot
responses. These are written before the HTTP send, so an early echo or missing
send response cannot trigger a feedback loop. A normal human command such as
`yes post` remains distinct from a longer bot reply that merely mentions it.

Received messages are persisted before queued work begins. Pending messages
resume on startup; work interrupted after processing began is not blindly
replayed. A saved `submitting` conversation becomes `uncertain` after a crash.
The group can request a draft or repeat an interrupted research request.
Messages that never reached the worker's receive callback depend on the Signal
bridge's delivery behavior.

If X accepted a note but the Signal reply failed, the local conversation stays
submitted. Repeating the link/status request reports the result without another
X request. If a POST timed out, returned a server error, or returned no note ID,
the bot cannot assume failure and will not retry. Uncertain claims reserve
capacity for 24 hours; abandoned in-flight claims reserve it until reconciled.
Both keep same-tweet retry protection until an operator resolves them.

To reconcile, stop the worker and check X's written notes for the target tweet,
including all relevant pages. In Supabase find the matching row in
`note_submission_claims`, then call `finish_note_submission_claim` with its ID:
`submitted` plus the confirmed X note ID, or `rejected` only after confirming
the request did not create a note. Supply a short reconciliation reason. Restore
the matching `notes` row if its original logging write failed. In the local
SQLite conversation JSON, set `status` to `submitted` and `noteId` to the verified
ID, or set `status` to `open` for a confirmed non-submission. Retain the draft and
approval record. Restart the worker; a retry still requires a new human `yes
post`. Never clear an unresolved claim just to free a slot.

## Local checks

```sh
bun test src/signal-bot src/pipeline/capacity/submissionReserve.test.ts src/pipeline/orchestration/submitNoteForTweet.test.ts src/pipeline/orchestration/submitCandidates.test.ts
bun run check
```

Tests use fake messages, fake X/LLM responses, and local SQLite. They do not send
Signal messages, submit notes, or consume paid APIs.

The migration also has an isolated PostgreSQL integration suite. To run it,
point `CN_RESERVE_TEST_PGLITE_PATH` at a separate PGlite installation's
`dist/index.js` and run
`bun test src/pipeline/capacity/submissionReserve.sql.test.ts`. This needs no
application credentials and applies the migration only in memory. PGlite
serializes clients, so this checks SQL behavior and competing async requests;
it does not simulate scheduling across independent PostgreSQL backends.
