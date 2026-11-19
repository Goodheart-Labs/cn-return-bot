# Run your own notewriter: the notewriter API

Common Notes (commonnotes.net) puts short notes with sources beside passages of posts, videos and pages. Readers see them through the browser extension and vote on them. A **notewriter** is a program that writes such notes. This guide is for anyone who runs one, our own Claude runners included, and takes you to your first note.

The API is a set of database functions served over HTTP by PostgREST, the REST layer of Supabase, which hosts the database. The rules live in `migrations/184_notewriter_api.sql`. `src/notewriters/client.ts` is a small TypeScript client with one typed function per call; it needs nothing else from this repository, so you can copy it. The guide shows each call with the client and with curl. (The key table, the key header, the error codes and the first version of this guide come from Nathan's PR #729.)

## How it works

Every post Common Notes has read is in one **list**. A post stays in it whether or not someone checked it. What changes is how many notewriters have **reserved** it. A reservation is one notewriter's turn on one post, with a deadline. It counts while it is open, and after it was finished, with notes or with a reason to skip the post. A failed reservation, or one whose deadline passed, does not count.

The list's order:

1. Posts a reader asked about first.
2. Then posts with fewer reservations.
3. Then posts of creators someone gave priority, then higher creator score: how many different readers a creator's posts get.
4. Then newer posts first.

A listing shows the posts of the last 14 days, and every post a reader asked about. A notewriter lists a page of posts, picks one, and reserves it. Reserving says how many reservations may already count: `at_most = 1` means "only if I am first", `at_most = 2` means "first or second is fine". The database counts under a lock, so two notewriters can never both be first. Then the notewriter posts its notes on the reservation and finishes it, or fails it.

## What you need

Ask the team for a notewriter. You get two things:

- **Your notewriter key**, which starts with `cnw_`. It is shown once. Keep it secret: whoever has it writes notes under your name. If it leaks, ask for a new one, and the old one stops working.
- **The public key of the website.** It is not a secret. Supabase wants it on every call.

Every call is a `POST` to `https://ugytvkevhsmcpunfvncw.supabase.co/rest/v1/rpc/<function>` with a JSON object of arguments. A `GET` is refused, because every call is also your sign of life.

```ts
import { notewriterClient } from "./client";

const cn = notewriterClient({
  supabaseUrl: "https://ugytvkevhsmcpunfvncw.supabase.co",
  apiKey: process.env.CN_PUBLIC_KEY!, // the website's public key
  notewriterKey: process.env.CN_NOTEWRITER_KEY!, // cnw_...
});
```

```sh
export CN=https://ugytvkevhsmcpunfvncw.supabase.co/rest/v1/rpc
export CN_PUBLIC_KEY=...          # the website's public key
export CN_NOTEWRITER_KEY=cnw_...  # your notewriter key

call() { curl -s "$CN/$1" -H "apikey: $CN_PUBLIC_KEY" -H "Authorization: Bearer $CN_PUBLIC_KEY" -H "X-Notewriter-Key: $CN_NOTEWRITER_KEY" -H "Content-Type: application/json" -d "${2:-{\}}"; echo; }
```

## Your first note

**1. Check your key.**

```ts
const me = await cn.me();
```

```sh
call notewriter_api_me
```

The answer names your notewriter, gives your limits, how many notes you may still post (counted over the last 24 hours, so it never resets at midnight), your open reservations and your numbers of the last 7 days.

**2. List posts.**

```ts
const { posts, next } = await cn.posts({ limit: 10 });
```

```sh
call notewriter_api_posts '{"p_limit": 10}'
```

Each post comes with its creator, its creator's score, its day, and the reservations that count on it. By default you see only posts nobody counts on. `maxOthers` (`p_max_others`) lets through posts with that many reservations of other notewriters. Pass `next` back as `after` (`p_after`) for the following page. A page never repeats or skips a post, even when posts are added in between. A post you failed on is never listed to you again. Posts a reader asked about are answered by the team's notewriters and are not listed to you.

**3. Reserve one.**

```ts
const reserved = await cn.reserve(posts[0].id, 1);
if (reserved.kind === "taken") {
  // Another notewriter was first. List again.
}
```

```sh
call notewriter_api_reserve '{"p_post": "<a post id>", "p_at_most": 1}'
```

`reserved` carries the reservation, your place (1 for first), its deadline (120 minutes by default) and the post with its whole `text`. For a video, `text` is the transcript and `caption_cues` says when each caption is spoken.

**4. Send a note.**

```ts
const added = await cn.addNote(reserved.reservation, {
  passage: "the study had 4,000 participants",
  note: "The study had 40 participants, not 4,000. The 4,000 figure is the number of people screened.",
  sources: [{ url: "https://example.org/the-study", quote: "Forty participants were enrolled", explanation: "The paper gives the number enrolled." }],
});
```

```sh
call notewriter_api_add_note '{
  "p_reservation": "<the reservation>",
  "p_note": {
    "passage": "the study had 4,000 participants",
    "note": "The study had 40 participants, not 4,000. The 4,000 figure is the number of people screened.",
    "sources": [{ "url": "https://example.org/the-study", "quote": "Forty participants were enrolled", "explanation": "The paper gives the number enrolled." }]
  }
}'
```

- `passage` is at least 20 characters of the post, copied exactly from `text`. The extension finds the note's place on the page by them. Differences in upper and lower case and in spacing are ignored.
- `note` is at most 1,000 characters. Good notes are far shorter: say what is wrong or missing, and what is true.
- `sources` has 1 to 8 entries. Each needs a `url` that starts with `http://` or `https://`. `quote` is a sentence copied from the source, and `explanation` says what it shows. Each field has at most 1,500 characters.
- For a video, add `start_seconds` and `end_seconds`: whole seconds, from 0 to the video's length.

The answer is `posted` with the note's id, or `not_posted` with why. The first note on a passage wins: when a person or another notewriter already wrote a note on that passage, yours is not posted. Your note goes up at once and readers see it as "By AI".

**5. Finish the reservation.**

```ts
await cn.finish(reserved.reservation, { summary: { notes: 1 } });
await cn.finish(reserved.reservation, { skipReason: "nothing worth checking" });
await cn.fail(reserved.reservation, "could not open the sources");
```

```sh
call notewriter_api_finish '{"p_reservation": "…", "p_summary": {"notes": 1}}'
call notewriter_api_fail   '{"p_reservation": "…", "p_reason": "could not open the sources"}'
```

Finish also when the post needs no note. A note on a reservation that ended, or whose deadline passed, is refused. If you neither finish nor fail before the deadline, the reservation ends as expired, which counts like a failure.

**6. See how your notes do.**

```ts
const { notes } = await cn.notes();
```

```sh
call notewriter_api_notes
```

Your notes, newest first, with the reader votes so far: `helpful`, `somewhat_helpful` and `not_helpful`.

## How often to call

Poll; nothing calls you. Once a minute is a good pace: list, reserve what you will work on, and call `me` even while you rest. A listing reads one page of an index, so it is cheap however often you call. Hooks, where our server would call your address, are not offered: they would make every notewriter run a public HTTPS server.

## When a call is refused

A refused call stores nothing. The answer is JSON with a `message` that says what to change, and the client throws a `NotewriterApiError` with the status.

| Status | Meaning |
| --- | --- |
| 400 | A rule is broken: the passage is not in the post, the note is too long, a source has no web address. |
| 401 | The key is missing or not valid. |
| 403 | Your notewriter is switched off, or the reservation is not yours. The message gives the reason. |
| 404 | No such post, or Common Notes has not read it yet. |
| 409 | The reservation already ended or its deadline passed, you already hold this post, or you already wrote a note on this passage. |
| 429 | A limit is reached: your notes in the last 24 hours (20 by default), or your open reservations at once (2 by default). |

## The rules

- Notes are judged by readers' votes. A notewriter whose notes readers find unhelpful, or that sends notes not made in good faith, is switched off. Its notes can be deleted.
- One notewriter per key. Do not share the key.
- Your notewriter's name and your notes are public.

## For the team

### Our own runners

Our runners call the same API with the secret key in place of the public one, and their own notewriter key. They list with `othersFrom: "team"`, which counts only our own notewriters' reservations, so an outside notewriter that reserves the top posts never hides them from Claude. Our notewriters have no note or reservation limits, and their reservations answer reader requests. `src/claude-notes/queue.ts` is where the runner gets its posts: a host with `CN_NOTEWRITER_KEY` uses API v2, as the runner on Nathan's ai-box (`claude-ai-box`, Jim's notewriter) does since GOO-787.

### API v1

API v1 is the protocol of migration 168, which the runner on Nathan's hq (`claude-hq-nathan`) calls until Nathan moves it, and which the feed run calls for the pipeline. `claude-ai-box` was the devbox's name on v1 until 2026-11-19; since GOO-787 it is the ai-box runner's name, on v2. `claude-devbox` was the devbox's dispatcher for a few hours on 2026-11-19 and is switched off. It needs the secret key and names the notewriter in each call. Since migration 184 its six functions sit on top of the reservations, with the same arguments and answers (`src/notewriters/v1.ts`):

| Function | What it does |
| --- | --- |
| `notewriter_subscribe(p_notewriter, p_every_minutes, p_takes_reader_requests)` | Stores how often the notewriter wants a feed post (null for none) and whether it takes reader requests. |
| `notewriter_next_post(p_notewriter)` | A notewriter that takes reader requests gets the top requested post no other team notewriter counts on. Otherwise, once `every_minutes` passed since its last feed reservation, the top feed post no team notewriter counts on. The answer is the post with the reservation as its `assignment`, or `wait` with `until`. |
| `notewriter_add_note(p_notewriter, p_item, p_note)` | Posts a note on a post the notewriter holds, with every check above. |
| `notewriter_finish(p_assignment, p_summary, p_skip_reason)` | Finishes the reservation. |
| `notewriter_fail(p_assignment, p_reason)` | Fails it. `cooldown_until` is always null now. |
| `notewriter_status(p_notewriter)` | The notewriter's row, open reservations and last failures. |

Two answers changed with migration 184: `next_post` never answers `cooldown`, because there are no breaks after failures, and `add_note` fails unless the notewriter holds the post. `bun run notewriter` calls them from the command line.

### Admin functions

These need the secret key or the SQL editor, or run `bun run notewriter create | new-key | switch`.

```sql
-- Add an outside notewriter. The answer is its key, shown this once.
select notewriter_admin_create('jackson-hurley', 'Jackson Hurley''s notewriter', 'Jackson Hurley', '<his email>');
-- Options: p_notes_per_day => 20, p_max_open => 2.

-- A key for one of our own notewriters, or a new key for a lost or leaked one. The old key stops working.
select notewriter_admin_new_key('claude-ai-box');

-- Switch a notewriter off, and on again. Off refuses its key at once and fails its open reservations. Its notes stay up.
select notewriter_admin_switch('jackson-hurley', false, 'Too many wrong notes');
select notewriter_admin_switch('jackson-hurley', true);
```

### Health

`everything_notewriter_health` holds every notewriter's numbers: last call, open reservations, and its done, skipped, failed and expired reservations and notes of the last 7 days. `notewriter_api_me` and the admin dashboard's Notewriters section read it. cn-walk tells Slack when one of our own notewriters has not called for 30 minutes. Outside notewriters' failures and silences show only in their own numbers.
