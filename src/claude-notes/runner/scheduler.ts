/* The runner's scheduler (GOO-787): everything that is the same for every
 * kind of job. On each round it
 *  1. picks up, after a restart, the Claudes that were at work,
 *  2. stops every Claude still at work at its time limit,
 *  3. closes every job whose Claude has ended: counts it for the failure
 *     alert, writes its cost row, and lets the job kind close it,
 *  4. while Claudes may start, starts the retries, then fills each kind's free
 *     slots with its waiting work, in the order the kinds are listed.
 *
 * A retry that comes up while Claudes may not start waits for the next round
 * that allows it. The scheduler holds nothing that matters across a restart:
 * a post or a tweet whose Claude was at work is found again through its kind's
 * `held`, and other work is simply still waiting. */

import type { recordClaudeRun } from "../store";
import type { EndedRun, JobKind } from "../jobs/kind";
import type { RunUsage } from "./runUsage";
import type { ClaudeCommand } from "./session";

/** What the scheduler needs from the world, so a test can stand in for it. */
export type SchedulerDeps = {
  kinds: JobKind<any>[];
  sessions: {
    start(session: string, runDir: string, prompt: string, command: ClaudeCommand): void;
    alive(session: string): boolean;
    stop(session: string): void;
    /** When a picked-up session started, or null when it never did. */
    startedAt(runDir: string): number | null;
    failure(runDir: string): string | null;
    usage(runDir: string): RunUsage;
  };
  runFolder(kind: string, key: string): string;
  mayStart(): Promise<boolean>;
  /** The plan's weekly usage now, for the job's log. */
  weekly(): Promise<number | null>;
  recordRun: typeof recordClaudeRun;
  claudeEnded(failure: string | null): Promise<void>;
};

type Running = {
  kind: JobKind<any>;
  work: unknown;
  key: string;
  session: string;
  runDir: string;
  attempt: number;
  startedAt: number;
  weeklyAtStart: number | null;
  stopAt: number;
  timedOut: boolean;
};

/** tmux needs short session names, and the start of an id is unique enough. */
const SESSION_KEY_CHARS = 20;

export function createScheduler(deps: SchedulerDeps) {
  const running = new Map<string, Running>();
  /** Work two Claudes failed on. It waits for a person or a restart. */
  const gaveUp = new Set<string>();
  const retries: { kind: JobKind<any>; work: unknown; attempt: number }[] = [];
  const id = (kind: JobKind<any>, key: string) => `${kind.name}/${key}`;
  const sessionName = (kind: JobKind<any>, key: string) => kind.sessionPrefix + key.slice(0, SESSION_KEY_CHARS);

  async function start(kind: JobKind<any>, work: unknown, attempt: number) {
    const key = kind.key(work);
    const runDir = deps.runFolder(kind.name, key);
    let prepared;
    try {
      prepared = await kind.prepare(work, runDir, attempt);
    } catch (err) {
      console.error(`Could not start the ${kind.name} ${key}: ${(err as Error).message}`);
      await deps.claudeEnded(`Could not start the ${kind.name} ${key}: ${(err as Error).message}`);
      return;
    }
    if (!prepared) return;
    const session = sessionName(kind, key);
    deps.sessions.start(session, runDir, prepared.prompt, prepared.command);
    const startedAt = Date.now();
    running.set(id(kind, key), { kind, work, key, session, runDir, attempt, startedAt, weeklyAtStart: await deps.weekly(), stopAt: kind.stopAt(work, startedAt), timedOut: false });
    console.log(`Started ${session} (attempt ${attempt})`);
  }

  async function pickUpHeld() {
    for (const kind of deps.kinds) {
      for (const work of (await kind.held?.()) ?? []) {
        const key = kind.key(work);
        const runDir = deps.runFolder(kind.name, key);
        const startedAt = deps.sessions.startedAt(runDir) ?? Date.now();
        // A session that is gone is closed in this same round, as any ended one.
        running.set(id(kind, key), { kind, work, key, session: sessionName(kind, key), runDir, attempt: 1, startedAt, weeklyAtStart: null, stopAt: kind.stopAt(work, startedAt), timedOut: false });
      }
    }
  }

  function stopIfOverdue(run: Running) {
    if (Date.now() < run.stopAt || !deps.sessions.alive(run.session)) return;
    deps.sessions.stop(run.session);
    run.timedOut = true;
    console.error(`Stopped ${run.session}: still at work ${Math.round((Date.now() - run.startedAt) / 60_000)} minutes after it started, at its time limit`);
  }

  async function close(run: Running) {
    running.delete(id(run.kind, run.key));
    await deps.claudeEnded(run.timedOut ? `${run.session} was stopped at its time limit` : deps.sessions.failure(run.runDir));
    await deps.recordRun({ tags: run.kind.tags, startedAt: run.startedAt, runDir: run.runDir, usage: deps.sessions.usage(run.runDir), ref: run.kind.ref(run.work, run.runDir) });
    const ended: EndedRun = { runDir: run.runDir, attempt: run.attempt, startedAt: run.startedAt, weeklyAtStart: run.weeklyAtStart, weeklyAtEnd: await deps.weekly(), timedOut: run.timedOut };
    const outcome = await run.kind.close(run.work, ended);
    if (outcome === "gave_up") gaveUp.add(id(run.kind, run.key));
    if (outcome === "retry") retries.push({ kind: run.kind, work: run.work, attempt: run.attempt + 1 });
  }

  async function startWaiting() {
    for (const retry of retries.splice(0)) await start(retry.kind, retry.work, retry.attempt);
    for (const kind of deps.kinds) {
      const free = kind.maxRunning - [...running.values()].filter((run) => run.kind === kind).length;
      if (free <= 0) continue;
      const fresh = (await kind.waiting(free)).filter((work) => !running.has(id(kind, kind.key(work))) && !gaveUp.has(id(kind, kind.key(work))));
      for (const work of fresh.slice(0, free)) await start(kind, work, 1);
    }
  }

  return {
    async tick(first: boolean) {
      if (first) await pickUpHeld();
      for (const run of running.values()) stopIfOverdue(run);
      for (const run of [...running.values()]) if (!deps.sessions.alive(run.session)) await close(run);
      if (await deps.mayStart()) await startWaiting();
    },
    /** Claudes at work now. */
    running: () => running.size,
  };
}
