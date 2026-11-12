# Judging GPT's notes on one post

We run a fact-checking site, Common Notes (commonnotes.net). It shows short notes, similar to Community Notes on X, on passages of Substack posts. Readers vote each note Helpful, Somewhat helpful or Not helpful. A note counts as "rated helpful" once its votes make that decisive.

We just ran a new note writer, GPT-6.1 Terra, on four posts that already had notes. You judge its work on one post. Your files are in `src/scripts_jim/2026_11_02_gpt_experiment_1/out/judgements/`, named by the post's slug:

- `<slug>.post.txt`: the post's full text.
- `<slug>.input-existing.json`: every note that was already on the site, with who wrote it (`writer`: claude, human or pipeline), its rating (`rating`: helpful, not_helpful or needs_ratings) and its vote counts.
- `<slug>.input-gpt.json`: every draft GPT saved. Each has an `index`, the `passage`, an `outcome` (note, no_note_needed or too_hard), the `note`, GPT's `reasoning` and its `sources` with quotes.

## What good notes look like

Jim, who runs the project, describes good notes like this: "Notes that point out something clearly wrong/misleading are great, notes that point out a minor error can also be good (but there you need some taste to see if it's an actual minor error that the author would be happy to correct) or if the author was just a bit loose in their language as a deliberate choice, notes that add additional context to support the author's point or to explain something with the goal of making readers less confused can be good but this also requires taste: notes in this category can easily be unnecessary for most readers which is bad or the additional detail can add more confusion than clarity."

`docs/note-examples.md` in the repository has many judged examples of good and bad notes. Skim it to calibrate your taste, especially the not-helpful ones.

## Your two tasks

**1. Did GPT find the notes rated helpful?** For each existing note with `rating` "helpful", decide:
- `yes`: one of GPT's drafts with outcome "note" makes the same main point. The passage may be a little different.
- `partly`: a GPT note touches the same issue but misses or weakens the main point.
- `no`: no GPT note makes the point. If GPT saved a draft on that passage without a note, say so in the comment.

Also list the indexes of the GPT drafts that match.

**2. Judge each of GPT's notes** (only drafts with outcome "note"):
- `found`: it is the match for a note rated helpful (a `yes` above).
- `good`: correct, and most readers of the post would find it helpful.
- `unsure`: borderline, or you cannot tell whether it is correct or wanted.
- `bad`: wrong, misreads the author (a joke, deliberate loose wording, an opinion), pedantic, or unnecessary.

Check facts when you are not sure. Open GPT's sources and search the web. A note whose source quote is not on the page, or whose central claim is wrong, is bad. If a GPT note matches an existing note that is not rated helpful, mention that note's rating in your comment.

## Output

Write `src/scripts_jim/2026_11_02_gpt_experiment_1/out/judgements/<slug>.json` with exactly this shape:

```json
{
  "summary": "Two or three sentences on how GPT did on this post overall.",
  "existing": { "<existing note id>": { "found": "yes", "gpt": [3], "comment": "..." } },
  "gpt": { "<draft index as a string>": { "verdict": "good", "comment": "..." } }
}
```

`existing` has an entry for every note rated helpful, and only those. `gpt` has an entry for every draft with outcome "note", and only those.

Write every comment in one or two short, plain, complete sentences that say why. Jim reads them. Never use an em dash. Don't change any other files. Your final message is a short summary of the counts and anything surprising.
