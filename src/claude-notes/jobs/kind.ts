/* What every kind of job of the runner looks like (GOO-787). The scheduler
 * (runner/scheduler.ts) does everything that is the same for all of them:
 * free slots, the budget gate, the deploy freeze, time limits, alerts, cost
 * rows, and picking up Claudes after a restart. A job kind says only which
 * work is waiting, how to prepare one job, and how to close it. */

import type { recordClaudeRun } from "../store";
import type { ClaudeRunTag } from "../usageShare";
import type { ClaudeCommand } from "../runner/session";

/** A Claude that ends without its answer gets one more try. */
export const MAX_ATTEMPTS = 2;

/** A Claude is stopped this long before its job's own deadline, so the runner
 *  still has time to save what it did and close the job itself. */
export const STOP_BEFORE_DEADLINE_MS = 10 * 60_000;

/** A job ready for its Claude. */
export type Prepared = { prompt: string; command: ClaudeCommand };

/** One Claude's try at a job, once it has ended. `timedOut` says that the
 *  scheduler stopped it at its time limit; such a job gets no second try. */
export type EndedRun = {
  runDir: string;
  attempt: number;
  startedAt: number;
  weeklyAtStart: number | null;
  weeklyAtEnd: number | null;
  timedOut: boolean;
};

/** "closed": done, whatever came of it. "retry": start another Claude.
 *  "gave_up": two Claudes failed; the work waits for a person or a restart. */
export type CloseOutcome = "closed" | "retry" | "gave_up";

export const mayRetry = (run: EndedRun) => run.attempt < MAX_ATTEMPTS && !run.timedOut;

export interface JobKind<Work> {
  /** Also the name of the job's folder under the runs folder. */
  name: string;
  /** Its Claudes run in tmux sessions named this plus the start of the key. */
  sessionPrefix: string;
  maxRunning: number;
  /** What the run was for, on its cost row (usageShare.ts). */
  tags(work: Work): ClaudeRunTag[];
  key(work: Work): string;
  /** Work ready to start, best first. The scheduler leaves out the keys it is
   *  running or gave up on and starts at most `limit`. Called only while
   *  Claudes may start. A kind whose call reserves work, the posts, returns at
   *  most `limit`. */
  waiting(limit: number): Promise<Work[]>;
  /** Work whose Claude was at work when the runner last stopped, so a new
   *  runner picks it up. Leave out for work that nothing records as begun. */
  held?(): Promise<Work[]>;
  /** Writes what the Claude needs into its run folder and says how to run it.
   *  Null when the work needs no Claude after all, for example a skipped
   *  post; the kind has then closed it. Throws when the work cannot start, after
   *  closing it as failed. */
  prepare(work: Work, runDir: string, attempt: number): Promise<Prepared | null>;
  /** When the scheduler stops the work's Claude if it is still at work. */
  stopAt(work: Work, startedAt: number): number;
  /** What the cost row of a run links to. */
  ref(work: Work, runDir: string): Parameters<typeof recordClaudeRun>[0]["ref"];
  close(work: Work, run: EndedRun): Promise<CloseOutcome>;
}
