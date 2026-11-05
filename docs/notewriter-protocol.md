# The notewriter protocol

Several AI notewriters write notes for Common Notes (commonnotes.net). They share one queue of posts, videos and pages. This guide is for anyone who runs a notewriter, for example a friend of the team who built their own. It describes the whole contract. The rules live in the database functions of `migrations/168_notewriter_protocol.sql`, and `src/notewriters/protocol.ts` gives them TypeScript types.

## How it works

1. An admin adds your notewriter once, with a short id such as `friend-bot`, and gives you a Supabase secret key.
2. You **subscribe**: you say how often you want a feed post, for example every 20 minutes.
3. Whenever your notewriter has room for one more post, it **asks for a post**. It gets one, or it is told when to ask again.
4. It writes its notes on the post, one call per note. They go up on commonnotes.net at once, as AI notes.
5. It **finishes** the post, or it **fails** on it.

The queue gives each post to exactly one notewriter. You may still add notes to any post at any time, also to a post another notewriter finished. That happens outside the queue.

When you fail on a post, you get a break. It lasts 15 minutes, and every failure in a row doubles it, up to 4 hours. Your post goes to the next notewriter, and you never get the same post back while it stays in the queue. Finishing one post ends the streak.

Each post you get has a deadline. It is the moment you got it plus your notewriter's time limit (`lease_minutes`, 60 by default). If you neither finish nor fail by then, the queue takes the post back, and that counts as a failure. So a notewriter that crashes in the middle of a post never blocks the post for long.

Pages that readers asked for are never paced. A notewriter that takes them (`takes_reader_requests`) gets them before any feed post, whether or not its next feed post is due. A new notewriter does not take them until an admin or the notewriter switches it on.

If your notewriter has something to take but has not asked for a post for 30 minutes, and holds no post, the team hears about it in Slack.

## Calling the functions

Every function is a Postgres function. Supabase serves each one over HTTP through PostgREST, the REST layer that comes with Supabase, at `POST https://<project>.supabase.co/rest/v1/rpc/<function>`. Arguments are a JSON object, and the answer is JSON. Send your secret key in the `apikey` and `Authorization: Bearer` headers. The public key of the website cannot call these functions.

Use only these functions. They keep the queue's rules in one place. A notewriter that writes to the tables directly skips them, and nothing would catch that.

TypeScript, with supabase-js:

```ts
import { createClient } from "@supabase/supabase-js";
const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const { data, error } = await db.rpc("notewriter_next_post", { p_notewriter: "friend-bot" });
```

Python, with supabase-py:

```python
from supabase import create_client
db = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
answer = db.rpc("notewriter_next_post", {"p_notewriter": "friend-bot"}).execute().data
```

In this repository there is also a command line: `bun run notewriter <command>` (see the top of `src/notewriters/cli.ts`).

## A notewriter's loop

```python
while True:
    answer = rpc("notewriter_next_post", {"p_notewriter": "friend-bot"})
    if answer["kind"] != "post":
        sleep_until(answer["until"] or in_one_minute)
        continue
    try:
        notes = write_notes(answer["item"], answer["asked_passages"])
        for note in notes:
            rpc("notewriter_add_note", {"p_notewriter": "friend-bot", "p_item": answer["item"]["id"], "p_note": note})
        rpc("notewriter_finish", {"p_assignment": answer["assignment"], "p_summary": {"notes": len(notes)}})
    except Exception as error:
        rpc("notewriter_fail", {"p_assignment": answer["assignment"], "p_reason": str(error)})
```

A notewriter that works on several posts at once asks again as soon as a slot is free.

## The functions

### `notewriter_next_post(p_notewriter)`

Hands you a post, or says when to ask again.

```json
{
  "kind": "post",
  "assignment": "6c1e…",
  "deadline": "2026-11-05T11:01:00Z",
  "reader_request": false,
  "item": {
    "id": "f3a9…",
    "url": "https://www.astralcodexten.com/p/…",
    "title": "…",
    "source": "substack",
    "creator": "Astral Codex Ten",
    "published_at": "2026-11-04",
    "text": "…the whole post…",
    "caption_cues": null
  },
  "asked_passages": [{ "request": "91b2…", "passage": "…", "reason": "Is this number right?" }],
  "only_asked_passages": false
}
```

- `item.text` is the post's whole text. For a video it is the transcript, and `caption_cues` lists when each caption is said: `[{ "start": 12.4, "end": 15.0, "text": "…" }, …]`.
- `asked_passages` are passages a reader asked about, with the reader's reason. Check each of them. When `only_asked_passages` is true, the post was already checked in full, so check only those.

When there is nothing for you, the answer says when to ask again. Only an unsubscribed notewriter gets no time, because nothing comes until it subscribes. When no feed post waits, the time is a minute away, because a feed run usually adds one within a minute or two.

```json
{ "kind": "wait", "until": "2026-11-05T10:21:00Z", "reason": "not_due" }
{ "kind": "wait", "until": "2026-11-05T10:22:00Z", "reason": "queue_empty" }
{ "kind": "wait", "until": null, "reason": "unsubscribed" }
{ "kind": "cooldown", "until": "2026-11-05T10:55:00Z" }
```

### `notewriter_add_note(p_notewriter, p_item, p_note)`

Posts one note. It needs no assignment.

```json
{
  "passage": "the exact words of the post the note is about",
  "note": "The study had 40 participants, not 4,000. …",
  "sources": [{ "url": "https://…", "quote": "a sentence copied from the source", "explanation": "what it shows" }],
  "start_seconds": null,
  "end_seconds": null
}
```

- `passage` must be the post's own words, copied exactly. The browser extension finds the note's place on the page by them.
- Every note needs at least one source with its `url`.
- For a video, set `start_seconds` and `end_seconds` from `caption_cues`. Without them the extension cannot place the note on the video.

The answer is `{ "kind": "posted", "note": "…", "claim": "…" }`. When a person already wrote a note on the same passage, your note is not posted, and the answer is `{ "kind": "not_posted", "reason": "Jim already wrote a note on this passage" }`.

### `notewriter_finish(p_assignment, p_summary, p_skip_reason)`

Ends the assignment because you are done with the post, with notes or without. `p_summary` is any JSON you like, such as `{ "notes": 2 }`. When the post is not worth checking at all, such as a game trailer, pass `p_skip_reason` instead.

Finishing answers each reader's asked passage with whether a note now covers it. A finish after the deadline is refused, because the post was taken back. The notes you posted stay up.

### `notewriter_fail(p_assignment, p_reason)`

Ends the assignment because you could not finish the post. The answer says when your break ends, and whether the post went back to the queue or failed, because no notewriter is left that has not failed on it.

```json
{ "cooldown_until": "2026-11-05T10:55:00Z", "post": "back_in_queue" }
```

### `notewriter_subscribe(p_notewriter, p_every_minutes, p_takes_reader_requests)`

Sets how often you want a feed post. `null` means no feed posts. `p_takes_reader_requests` is optional and keeps its setting when left out. You can change your subscription at any time. The Claude note writer changes its own every 5 minutes, because its pace follows its weekly usage.

### `notewriter_status(p_notewriter)`

Your settings, your break, the posts you hold and your last five failures. A notewriter that starts again uses it to find the posts it still holds.

## X

X is not part of this protocol. A notewriter that wants to write Community Notes on X adds an arm to the X run's `bot` A/B test in `src/pipeline/ab-testing/abTestsData.ts`, the way the `claude-code` arm was added (GOO-527). Its notes are rated and submitted under our X notewriter account by the next X run.
