# Why the prefilter query writer returns no queries (2026-07-02)

Question: in the note-needed prefilter, the query writer sometimes returns
`{"queries": []}` on all 3 retry attempts, so the tweet is rejected as
`prefilter_no_note` ("query writer returned no queries — opinion/joke/non-checkable").
Why — and does it cost us notes?

## Scale

From prod (`fetch_missed_opps.py`):
- 8,336 missed-opportunity competing notes total (helpful note by someone else
  on a tweet we ran but didn't note).
- 283 of those trace to a `prefilter_no_note` rejection.
- **78 (28% of prefilter misses) were rejected specifically because the query
  writer returned no queries** — all 78 burned the full 3 retry attempts.
- 54/78 (69%) of those tweets have media. The pattern: media-driven misinfo
  (AI-generated photo, parody ad presented as real, miscaptioned images) whose
  *text* reads like a meme/joke.

## Three mechanisms, confirmed via raw OpenRouter responses (replayQueryWriter.ts)

1. **Deliberate joke classification — the dominant one.** The prompt has an
   escape hatch: "If the post is pure opinion / joke / satire with no checkable
   factual claim, return an empty queries list." On meme-framed media misinfo
   the model reasons its way into it. Tweet 2066077934868132153 (Troll Football,
   "Two and a Half Men", 226K impressions): reasoning says *"clearly a
   joke/visual pun about the height comparison... The image shows actual
   players... no queries needed"*. The image was AI-generated — the competing
   note saying exactly that got rated helpful. The query writer took the Gemini
   media description at face value; nothing in the prompt says media
   authenticity is itself a checkable claim.
   (raw_response_2066077934868132153_attempt1.json)

2. **Provider that doesn't reason.** OpenRouter routes deepseek-v4-flash to
   multiple providers. One attempt landed on provider "Morph" and returned
   `reasoning: null`, `reasoning_tokens: 0`, 9 completion tokens, `{"queries": []}`.
   Without its CoT the model degenerates to the lazy empty answer.
   `provider: { require_parameters: true }` does NOT protect against this —
   Morph accepts `reasoning_effort` but emits no reasoning.
   (raw_response_2069653660200845717_attempt2.json)

3. **Model-level nondeterminism at temp 0.** 12 identical calls all routed to
   AtlasCloud, all with real reasoning, still produced 2 empties
   (surveyProviders.ts). The joke-vs-checkable judgment is borderline and
   flips; temp 0 isn't deterministic on these hosts anyway. The reasoned empty
   on tweet 2069653660200845717 concludes "pure opinion and speculation...
   interpretation of a photo" while sibling attempts write
   "Georgina Rodriguez Ronaldo Jr photos June 2026" etc.
   (raw_response_2069653660200845717_attempt1.json)

So retry-on-empty (QUERY_WRITER_MAX_ATTEMPTS=3) only rescues mode 2/3 flips;
in mode 1 all three attempts agree the post is a "joke" and the tweet is
dropped.

## Fix ideas (not implemented)

- Prompt: state that a post presenting media as depicting a real moment makes
  an implicit checkable claim (authenticity/context) — write a query for it
  ("<event> photo AI generated", reverse-context queries). Keep it a general
  principle, not eval-specific tells.
- Mode 2: treat `reasoning_tokens === 0` as a failed attempt (retry), or
  restrict/deprioritize providers that don't emit reasoning.
- Alternative: on 3× empty, fall through to the note-needed judge with no
  findings instead of auto-rejecting (cost trade-off: more judge calls).
- FP-rate caveat: loosening the escape hatch raises prefilter pass-rate and
  bot cost; the downstream judge still gates, but measure before/after.

## Files

- `fetch_missed_opps.py` — finds the 78 cases (writes missed_opps.json)
- `replayQueryWriter.ts <tweet-id>` — replays the exact prod userMessage until
  the query writer returns empty; dumps the full raw OpenRouter response
- `surveyProviders.ts <tweet-id> [n]` — n identical calls, tabulates
  provider / reasoning_tokens / query count
