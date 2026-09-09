# Claim rating with web research: evaluation (GOO-97)

Question: if one Opus 5 call per item rates all claims with web search and web
fetch in hand, how many claims still land at "uncertain" or below, how much
fact-check money does that save, and which notes do we lose?

Method: `evaluate.ts` loads an item's stored text and its AI-extracted claims
from prod, runs `rateClaims` on them, and compares each new rating with what the
real fact-check produced for that claim. Read-only against prod. Rater calls go
through `OPENROUTER_TESTING_KEY`.

Items: the physics video (22 claims), the Texas post (8 claims) and the Hugging
Face interview (269 claims). Together they had 181 claims at "uncertain" or
below, $28.01 of fact-checks and 4 notes.

## Run 1: the configuration as first written

Basic fetch tool (`web_fetch_20250910`), no cache breakpoint, prompt without the
"rate the claim as stated" line. Result files in `results-run1/`.

| item | rater cost | input tokens | web searches | uncertain or below | notes lost |
|---|---|---|---|---|---|
| Physics video | $3.46 | 632k | 12 | 0 of 22 | 3 of 3 |
| Texas post | $1.57 | 265k | 7 | 1 of 8 | 0 of 0 |
| Hugging Face interview | $10.94 | 2.06M | 7 | 7 of 269 | 1 of 1 |
| total | $15.97 | | | 8 of 299 | 4 of 4 |

The ratings were what we wanted, but the rater cost was close to the money it
saved on the short items and $11 on the long one. The cause is how a call with
server-side tools is billed. Every search or fetch inside the call is a new
iteration, and each iteration is billed for the whole context again. The basic
fetch tool puts every page into the context in full, and its per-page token cap
does not apply to PDFs. On the interview the model read the 91-page METR report.

## Run 2: cache breakpoint, filtering fetch tool, stricter prompt

Three changes. A `cache_control` breakpoint on the user message, so the item
text and claims are cache reads on every iteration after the first. The fetch
tool version `web_fetch_20260318`, which lets the model filter a page with code
inside Anthropic's sandbox before the result enters the context. A prompt line
saying a claim with a wrong name, number or attribution is false. Result files
in `results-run2/`.

| item | rater cost | input tokens (cached) | web searches | uncertain or below | notes lost |
|---|---|---|---|---|---|
| Physics video | $0.53 | 365k (355k) | 11 | 0 of 22 | 3 of 3 |
| Texas post | $0.28 | 110k (105k) | 6 | 0 of 8 | 0 of 0 |
| Hugging Face interview | $1.61 | 990k (901k) | 6 | 1 of 269 | 1 of 1 |
| total | $2.42 | | | 1 of 299 | 4 of 4 |

Between 91% and 96% of input tokens were cache reads. The rater now costs $2.42
for the three items against $28.01 of fact-checks, and only one claim would
still be checked, for about $0.12.

Rating distribution in run 2: 155 certainly true, 116 likely true, 19 somewhat
likely true, 1 likely false. The one "likely false" is the Hugging Face claim
that the OpenAI patch removed the message board by accident.

## The notes we lose

All four notes these items produced sit on claims the rater rates as true.

Three are on the physics video, and each corrects a name the auto-captions
misheard: "Maximilian Reich" for Max Weinreich, "Alexis Machete" for Alexis
Marchand, "Kerwin" for Kirwin Hampshire. The rater's research finds the right
names every time and still rates the claims "likely true" or "certainly true".
The prompt line added in run 2 did not change that. The model reads a misheard
name in a transcript as transcription noise, not as a false claim. Whether a
note that corrects a caption is a note we want is open.

One is on the interview: the claim that the earlier agents "were a version of
Sol", where the METR report says they were a separate internal model. The rater
rates it "somewhat likely true" in both runs, and in run 1 its own research
called the phrase speculation.

Gate options, computed over both runs from the result files:

| claims checked if the gate is ... | claims | fact-check cost | notes kept |
|---|---|---|---|
| uncertain and below (current) | 1 | $0.12 | 0 of 4 |
| somewhat likely true and below | 21 | $3.44 | 1 of 4 |
| likely true and below | 144 | $14.39 | 3 of 4 |

Moving the gate one level keeps the substantive note for about $3.44 across
these items. The caption-name notes are only reachable by checking nearly
everything, which is what we do today.

## What is not measured

- Only three items, all picked because they had many uncertain claims. Items
  where the extractor's old judgement was already confident are not covered.
- Whether the rater is right. The comparison is against what the fact-check
  produced, and the fact-check found no correction on almost every claim the
  rater now calls true, but it does not say the rater would catch a false claim
  on a topic where the search finds nothing.
- Extraction cost, which the change does not touch beyond the model move to
  Opus 5.
