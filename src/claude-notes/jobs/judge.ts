/* The note judge as a job of the runner (GOO-591). Every note posted on
 * commonnotes.net, by any of our notewriters, gets one isolated Claude that
 * predicts how likely it is to be rated helpful and to make the leaderboard
 * (the prompt and the rules are in ../judge.ts). The review page shows both
 * numbers.
 *
 * The first look reads every posted note that has no judgement for its
 * current text, newest first. After that the job reads only the notes the log
 * recorded as posted since its last look. */

import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { BLOCKED_TOOLS, JUDGE_EXAMPLES_PATH, JUDGE_MODEL, JUDGE_SCHEMA, JUDGE_TIMEOUT_MS, type JudgedNote, type JudgeExample, judgementFrom, judgePrompt } from "../judge";
import { resultEvent } from "../runner/session";
import { draftsToJudge, latestEventId, postedAfter, readJudgedNote, saveJudgement } from "../store";
import { CLAUDE_RUN_TAGS } from "../usageShare";
import { type JobKind, mayRetry } from "./kind";

/** Judges at once. They share the plan's week with the writers, and one at a
 *  time keeps up with about 100 notes a day. */
const MAX_JUDGES_RUNNING = 1;

/** The note as the judge read it, kept in the run folder, so the judgement
 *  is saved for that text even if the note changed in the meantime. */
const judgedNoteFile = (runDir: string) => path.join(runDir, "judged-note.json");

/** The drafts still to judge, oldest first in the order they were posted, and
 *  the last "posted" entry of the log read so far. Null before the first look. */
let lastPostedEventId: number | null = null;
const queue: string[] = [];
const examples: JudgeExample[] = JSON.parse(readFileSync(JUDGE_EXAMPLES_PATH, "utf8"));

function enqueue(draftId: string) {
  if (!queue.includes(draftId)) queue.push(draftId);
}

function dequeue(draftId: string) {
  const index = queue.indexOf(draftId);
  if (index >= 0) queue.splice(index, 1);
}

export const judgeJob: JobKind<string> = {
  name: "judge",
  sessionPrefix: "cn-judge-",
  maxRunning: MAX_JUDGES_RUNNING,
  tags: () => [CLAUDE_RUN_TAGS.commonNotes, CLAUDE_RUN_TAGS.judge],
  key: (draftId) => draftId,

  async waiting() {
    if (lastPostedEventId === null) {
      lastPostedEventId = await latestEventId();
      for (const draftId of await draftsToJudge()) enqueue(draftId);
    }
    for (const posted of await postedAfter(lastPostedEventId)) {
      enqueue(posted.draftId);
      lastPostedEventId = posted.id;
    }
    return queue;
  },

  async prepare(draftId, runDir) {
    const note = await readJudgedNote(draftId);
    writeFileSync(judgedNoteFile(runDir), JSON.stringify(note));
    return {
      prompt: judgePrompt(note, examples.filter((e) => e.draftId !== draftId)),
      command: { model: JUDGE_MODEL, isolated: { jsonSchema: JUDGE_SCHEMA, disallowedTools: BLOCKED_TOOLS } },
    };
  },

  stopAt: (_draftId, startedAt) => startedAt + JUDGE_TIMEOUT_MS,
  ref: (draftId) => ({ draft_id: draftId }),

  /** Saves the judgement for the text the judge read. A judge without an
   *  answer gets one more try, and after that its note waits for a restart. */
  async close(draftId, run) {
    try {
      const note: JudgedNote = JSON.parse(readFileSync(judgedNoteFile(run.runDir), "utf8"));
      const judgement = judgementFrom(resultEvent(run.runDir));
      await saveJudgement(draftId, note.note, judgement);
      console.log(`Judged draft ${draftId}: P(helpful) ${judgement.pHelpful}, P(impactful) ${judgement.pImpactful}`);
    } catch (err) {
      console.error(`Could not judge draft ${draftId}: ${(err as Error).message}`);
      if (mayRetry(run)) return "retry";
      dequeue(draftId);
      return "gave_up";
    }
    dequeue(draftId);
    return "closed";
  },
};
