# Empty note card on YouTube (screenshot of 2026-09-16)

Jim's task, verbatim: "Spawn a claude to investigate this: ~/screenshots/shot-20260916-012142.png"

## Answer

The card is empty because the note is empty in the database. The pipeline wrote and
published a note whose text is the empty string and which cites no source. Nothing in
the extension or the website is broken: both render exactly what the row holds.

The row is `everything_notes` id `929b0389-aca3-47a6-bdfe-2a7c1833b209`, status
`published`, created 2026-09-11 01:05 UTC, on the claim "A remote viewer located the
crash site of a downed Soviet experimental aircraft in Siberia to within one or two
kilometers of the actual site." (claim id `a7624fd9-3488-4993-8c68-74c4a8dbd682`,
video `https://www.youtube.com/watch?v=hSQ1iVqEZO4`, seconds 1091 to 1116, project
`joerogan`).

It is not alone. Every published note whose text is empty:

| | count |
|---|---|
| published AI notes with empty text | 28 |
| of those with any vote | 0 |
| first one | 2026-08-29 |
| last one | 2026-09-13 |
| AI notes published in that period | 373 |

So about one published note in thirteen over those two weeks was empty. Nobody has
rated one yet, so the ratings are not polluted. The 28 rows are listed in
`data/empty_notes.json`. They sit on 10 projects; 11 are on `joerogan`, 17 are YouTube
videos, 6 Substack posts, 5 requested web pages.

## How an empty note gets published

The chain has four links. Each one is by design on its own, and the hole is that no
link checks for an empty note.

1. **The writer is allowed to answer with an empty note.** The writer is the LLM call
   that turns the search findings into the note text (`src/pipeline/simple-bot/writer.ts`).
   Its prompt (`src/pipeline/prompts/simple-bot/writer.ts`) says: return `note_text = ""`
   and `sources = []` when there is nothing to dispute. That is the writer's way of
   saying "no note". The prompt even promises that "the downstream judge will record
   `no_correction_needed`". The writer here (arm `sonnet5`) did exactly that: its answer
   was `{"note_text": "", "sources": []}`.

2. **No code reads that answer as "no note".** The orchestrator
   (`src/pipeline/simple-bot/orchestrator.ts`, `produceWriterOutput` and `runGates`) has an
   early exit only when the *search* step says no correction is needed. An empty answer
   from the writer goes straight on to the source verifier like any other note. There
   is no "downstream judge" that maps an empty note to `no_correction_needed`; the
   prompt describes a check that does not exist.

3. **The classic source verifier accepts an empty note.** The verifier is the LLM call
   that checks whether the cited sources support the note
   (`src/pipeline/verify/sourceVerifier.ts`). It gets the prompt section
   "## Proposed community note" followed by nothing, plus the search findings as
   background. The Common Notes pipeline forces the `classic` flavour, one call that
   answers accept or reject (`FORCED_PICKS` in `src/everything/pipeline/checkClaims.ts`,
   since 2026-07-15). In this run it answered `accepted: true` with the reasoning "The
   note correctly identifies a factual error in the speaker's claim ... Central Africa,
   not Siberia". It judged the findings, not the note, because there was no note to
   judge. Across all Common Notes check runs the writer answered empty 36 times and the
   classic verifier accepted 28 of them (`empty_answer_rate.py`). The X pipeline uses the
   `claim-based` flavour, which first extracts the note's claims and then verifies each;
   on an empty note it extracts the claim "A community note has been proposed", finds no
   source for it and rejects. In one day of X runs (2026-09-11) it rejected all 20 empty
   notes that reached it. That is why X never submits empty notes and Common Notes does.
   The verifier's acceptance is the step that turned "no note" into "publish this".

4. **The last gate never runs for Common Notes.** After the verifier, the pipeline asks
   X's `evaluate_note` endpoint to score the note (`scorePipelineResult` in
   `src/pipeline/orchestration/processTweet.ts`). A Common Notes claim is wrapped in a
   synthetic post whose id is not a tweet id, so X answers 403 on every call (before
   2026-09-09 the call failed earlier with "Missing required environment variable
   X_API_KEY"). `determineOutcome` skips the gate when the call errors, on purpose, so
   a good note is not lost to an outage. For Common Notes that means the gate is always
   skipped. The outcome becomes `candidate`, `buildClaimCheck` in `checkClaims.ts` turns it
   into `{ kind: "note", note: "" }`, and `insertNote` in `src/everything/db.ts` writes
   the row. The table has `note text not null`, which an empty string satisfies.

The run log that shows all four links is `data/run_fd0b5051-67f7-4850-bd7e-3d8a74c10bee.json`
(`logs.note_writer_steps.note_writer.attempts.0.response`, `logs.note_writer_steps.source_verifier`,
`logs.eval.error`, `logs.outcome`).

Two side facts. The pipeline arms on the failing runs were `simple_bot_writer=sonnet5`,
`simple_bot_search=sonnet5-native`, `simple_bot_verifier=gemini-flash`; the switch to
Muse landed on 2026-09-14, after which the writer answered empty 5 times and the Muse
classic verifier rejected all 5. Five is too few to call the hole closed by the model
change; the code path is unchanged. And the writer's empty answer on this very claim
was itself a poor call: the findings said the crash was in Zaire, not Siberia, which
is exactly the kind of dispute the note should have carried.

## Is the empty answer an API failure?

Jim asked whether the empty answer could be an API failure rather than the model's
choice. The output token counts first pointed that way: the writer call on this run
produced 493 output tokens, while `{"note_text":"","sources":[]}` is about ten. Across
the 28 empty runs the writer produced between 16 and 1628 output tokens, median 262,
and runs that wrote a real note produced 128 to 751.

Replaying the exact call resolves it (`replay_writer.ts`, the writer's logged messages
sent again to `anthropic/claude-sonnet-5` with the same strict JSON schema through the
testing key). Three replays of this run all came back with the content
`{"note_text":"","sources":[]}`, finish reason `end_turn`, and 291 to 1050 reasoning
tokens. Sonnet 5 thinks before answering, and OpenRouter counts the thinking in
`completion_tokens`, which the cost tracker stores as output tokens. That is where the
hundreds of tokens went. The reasoning text shows the decision: "the location detail
(Siberia vs. actual Zaire/Africa crash site) is factually wrong, but ... more like a
minor geographic mix-up than something that undermines the actual claim". Two replays
of another empty run (2026-09-11, a comedy timezone claim) answered empty both times.
Two replays of a third (2026-09-05, a benchmark figure) wrote a real note both times,
so on borderline claims the model flips between a note and no note. None of the
replays errored, refused, or returned an empty body.

So the empty answer is the model's own call, made under the prompt's instruction. Is
the writer asked whether a note is needed? Yes, twice. The search step first answers
`correction_needed` (`src/pipeline/prompts/simple-bot/searchAgent.ts`); the writer only
runs when that is true. The writer prompt then tells it to return an empty note when
the dispute would not topple the post's central argument (the `writer_central` arm of
`materiality_treatment`, since 2026-09-07; the default rule also allows an empty note
when nothing is disputed). On this claim the search step said a correction was needed
and the writer overruled it as immaterial. The code that follows treats the empty
answer as a written note.

A separate guard exists for a genuinely empty reply: `callWithRetry` in
`src/pipeline/llm/llm.ts` retries a 200 with empty content. It did not fire here
because the content was a valid JSON object.

## Where a check would have stopped it

- **At note writing (best place).** The orchestrator should treat an empty `note_text`
  from the writer the way it treats the search step's "no correction": return the
  `no_correction` outcome and never call the verifier. That is what the writer prompt
  already claims happens. It also saves the verifier and evaluation calls on every
  such run, for X too. This is the fix worth doing.
- **At publishing.** `insertNote` could refuse an empty note, and the table could carry
  a check constraint `length(btrim(note)) > 0` so no writer, human or AI, can store an
  empty note again. The constraint is the durable guard; the 28 rows would have to be
  removed or filled first.
- **At rendering.** The website (`NoteCard.tsx`, `noteText()`) and the extension
  (`ClaimNoteStack` via `NoteWithActions`) render `note.note` as is. A guard here would
  hide the symptom but leave empty rows in the feed and in the counts, so it is the
  wrong place on its own.

## What the website shows

The public website renders the same blank card. Opened headlessly at
`https://goodheart-labs.github.io/cn-return-bot/notes/?project=joerogan&note=929b0389-aca3-47a6-bdfe-2a7c1833b209`
(`website_screenshot.ts`, screenshots in `data/website_note*.png`), the card shows the
context column, the video embed, the quote, the "Needs more ratings" badge, the three
vote buttons and the action links. The note body paragraph is an empty `<p>` with no
text node. There is no placeholder and no error state, so to a reader it is a live,
votable note with no text. The next card in the feed, on the "satellite radio
tomography" passage of the same video, is blank in the same way; it is one of the 28.

## Method

All reads went through the Supabase API client with the service key
(`SUPABASE_SERVICE_KEY` in `.env`); `PROD_DB_URL` was not tried, since the API
client covered everything. Scripts, run from the workspace root with `uv run`:

- `find_note.py`: finds the item and the note behind the quoted passage.
- `run_log.py`: dumps the check run row for that claim into `data/`.
- `count_empty.py`: counts empty published notes and their votes, writes `data/empty_notes.json`.
- `empty_runs.py`: the check runs behind all 28, their arms, compared with the period.
- `empty_answer_rate.py`: how often the writer answers empty and what each verifier flavour does with it.
- `x_side.py`, `x_side_detail.py`: the same question on the X pipeline (`pipeline_runs`), over a short window because a longer one hits the statement timeout.
- `website_screenshot.ts`: headless screenshot of the note on the public website.
- `writer_tokens_baseline.py`: writer output tokens on runs that produced a real note.
- `replay_writer.ts`: replays the writer call of an empty run and prints the raw reply (needs `OPENROUTER_TESTING_KEY`).
