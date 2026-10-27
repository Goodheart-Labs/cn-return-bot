/* The note judge experiment's prompts (GOO-588). The judge itself, and the
 * prompt that went into production, are in src/claude-notes/judge.ts. This
 * file adds what only the experiment used: the few-shot examples, and the
 * guidance of the last prompt we tried, Jim's flow chart (prompt 4 in
 * PROMPTS.md). */

import { JUDGE_INTRO, JUDGE_QUESTIONS, noteBlock, type JudgedNote } from "../../claude-notes/judge";

/** A note whose outcome is known, shown to the judge as an example. */
export interface JudgeExample extends JudgedNote {
  outcome: "helpful" | "not_helpful";
  /** Why a reviewer voted or rejected the way they did, when they said so. */
  reason: string | null;
}

const OUTCOME_LABELS: Record<JudgeExample["outcome"], string> = { helpful: "Helpful", not_helpful: "Not helpful" };

function examplesBlock(examples: JudgeExample[]): string {
  const entries = examples.map((e, i) =>
    [`### Example ${i + 1}: ${OUTCOME_LABELS[e.outcome]}`, noteBlock(e, false), ...(e.reason ? ["", `Reviewer's reason: ${e.reason}`] : [])].join("\n"),
  );
  return ["Here are earlier notes and how they were judged.", "", ...entries].join("\n\n");
}

export function judgePrompt(note: JudgedNote, examples: JudgeExample[] = []): string {
  return [
    JUDGE_INTRO,
    `- Put yourself in the shoes of a regular reader or viewer of this particular author or creator. So you probably know some things about the subject, you know the author, and in the vast majority of cases you know what the author means and what the author wants to say.
- Normal readers don't care about the style of a note, unless it is confusing.

Go through these questions in order.

1. Does the note clearly show how the original text was misleading to regular readers? If yes, go to question 3. If no, go to question 2.
2. Does the note clearly show that the original text had a minor error, one the author would gladly correct when it is pointed out to them? It doesn't matter where the error sits in the text, how important it is or how relevant it is. If yes, go to question 3. If no, go to question 4.
3. Does a favourable reading exist? If there are multiple different ways that a sentence or a word could be read, then assume the reading that is most favourable to the author. Regular readers will most likely assume the same reading. If a favourable reading exists which is neither misleading nor has any minor errors, then the note is very likely to be rated unhelpful. If not, the note is very likely to be rated helpful.
4. Does the note provide additional context or an explanation? If no, the note is very likely to be rated unhelpful. If yes, go to question 5.
5. Is the note confusing? If yes, the note is very likely to be rated unhelpful. If no, go to question 6.
6. Might the text that the note is on actually confuse lots of regular readers, and does the note help with that? If yes, the note is very likely to be rated helpful. If no, go to question 7.
7. Is the context or explanation interesting to regular readers, such that they are glad they have seen it? If yes, the note is very likely to be rated helpful. If no, the note is very likely to be rated unhelpful.`,
    ...(examples.length > 0 ? [examplesBlock(examples), "## The note to judge"] : []),
    noteBlock(note, true),
    JUDGE_QUESTIONS,
  ].join("\n\n");
}
