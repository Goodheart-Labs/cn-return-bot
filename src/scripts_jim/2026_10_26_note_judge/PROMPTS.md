# The judge prompts we tried (GOO-588)

Four versions of the note judge prompt, in the order we tried them. Every
version keeps the same opening paragraph, note block and closing questions
(p_helpful and p_impactful). They differ only in the guidance about what makes
a note helpful. Jim stopped this direction on 2026-10-27.

The scores are AUC (the chance that a random helpful note gets a higher
P(helpful) than a random not-helpful one, 0.5 is guessing) on the 61 labelled
notes of `buildDataset.ts`: 42 helpful and 19 not helpful. The newer half has
25 helpful and only 6 not-helpful notes, so its intervals are very wide.

| Prompt | Zero-shot, all 61 | Zero-shot, newer 31 | Few-shot, newer 31 |
|---|---|---|---|
| 1, the original | 0.67 | 0.48 | 0.55 |
| 2, with the reader guidance | 0.72 | 0.54 | 0.60 |
| 3, with the most favourable reading | only tried on two rejected notes | | |
| 4, Jim's flow chart | 0.71 | 0.61 | 0.36 |

On the newer half no prompt beat always guessing the share of helpful notes on
Brier score (0.156).

## Prompt 1, the original

Commit `a43d5478`. No guidance: the opening paragraph goes straight to the note
and the two questions.

## Prompt 2, with the reader guidance

Commit `de497348`. Jim's seven bullet points about how a regular reader of the
author judges a note, right after the opening paragraph. Commit `0ae5c9e8` has
the same bullets after the p_helpful question instead, but that version never
ran.

## Prompt 3, with the most favourable reading

This version was Jim's own edit of prompt 2 and was never committed on its own,
because the flow chart replaced it in the same working tree. It ran three
times on each of two rejected notes: the Three Mile Island note (0.42, 0.50,
0.42) and the Fable order note (0.66, 0.70, 0.70). Its guidance, word for word
as it ran:

```
- Put yourself in the shoes of a regular reader or viewer of this particular author or creator. So you probably know some things about the subject, you know the author, and in the vast majority of cases you know what the author means and what the author wants to say..
- If the note clearly shows how the original text was misleading to regular readers, then it will be rated helpful with a very high likelihood.
- If the note clearly shows that the original text had a minor error, one the author would gladly correct when it is pointed out to them, then the note is very likely to be rated helpful. It doesn't matter where the error sits in the text, how important it is or how relevant it is.
- If there are multiple different ways that a sentence or a word could be read, then assume the reading that is most favorible to the author. Regular reader will most likely assume the same reading. If a favorible reading exists which is neither misleading nor has any minor errors, then a note is very likely to be unhelpful.
- If the note reads like it wants to point out misinformation, but the text is not in fact misleading to a regular reader, then the note will be rated unhelpful with a very high likelihood.
- If the note provides context that a regular reader might not know, and the context enhances a regular reader's understanding such that they are glad they have seen it, or the text might actually confuse lots of regular readers, then the note is likely to be rated helpful.
- If the note provides additional context but does not fulfil the criteria of the previous point, then it is somewhat likely to be confusing, and if it is confusing, it is very likely to be rated unhelpful.
- Normal readers don't care about the style of a note, unless it is confusing.
```

## Prompt 4, Jim's flow chart

Commit `1a198913`, the current `judge.ts`. Jim's flow chart as seven yes/no
questions, each leading to the next question or to "very likely helpful" or
"very likely unhelpful". With it, the few-shot examples pushed the newer
rejected context notes toward helpful, and few-shot fell below guessing.

## Where the results are

`data/` is ignored by git, because it holds the reviewers' rejection reasons.
The results stay there on Jim's devbox: `v1-*`, `v2-*`, `v3-zero.jsonl` and
`v4-*`. Each judge's full prompt and output are on Nathan's ai-box under
`/tmp/cn-notes/judge-v1`, `judge-v2`, `judge/try-v3`, `judge/try-v4` and
`judge` (prompt 4), until the ai-box clears `/tmp`.
