import { describe, expect, test } from "bun:test";
import type { CloseOutcome, EndedRun, JobKind } from "../jobs/kind";
import { createScheduler, type SchedulerDeps } from "./scheduler";

/* The scheduler with fake job kinds and fake tmux sessions. A session stays
 * alive until a test ends it, as a Claude would by finishing. */

const MINUTE = 60_000;

function fakeWorld() {
  const alive = new Set<string>();
  const started: string[] = [];
  const stopped: string[] = [];
  const failures: (string | null)[] = [];
  const costRows: string[] = [];
  let mayStart = true;
  const deps = (kinds: JobKind<any>[]): SchedulerDeps => ({
    kinds,
    sessions: {
      start: (session) => {
        alive.add(session);
        started.push(session);
      },
      alive: (session) => alive.has(session),
      stop: (session) => {
        alive.delete(session);
        stopped.push(session);
      },
      startedAt: () => null,
      failure: () => null,
      cost: () => 0.5,
    },
    runFolder: (kind, key) => `/runs/${kind}/${key}`,
    mayStart: async () => mayStart,
    weekly: async () => 40,
    recordRun: async (run) => {
      costRows.push(run.runDir);
    },
    claudeEnded: async (failure) => {
      failures.push(failure);
    },
  });
  return {
    alive,
    started,
    stopped,
    failures,
    costRows,
    deps,
    finish: (session: string) => alive.delete(session),
    setMayStart: (value: boolean) => {
      mayStart = value;
    },
  };
}

/** A kind whose work is plain strings, with what its methods should do. */
function fakeKind(options: { name?: string; waiting?: string[]; held?: string[]; maxRunning?: number; stopAfterMs?: number; outcome?: (run: EndedRun) => CloseOutcome; skip?: string[] } = {}) {
  const closed: { work: string; run: EndedRun; outcome: CloseOutcome }[] = [];
  const kind: JobKind<string> = {
    name: options.name ?? "post",
    sessionPrefix: `cn-${options.name ?? "post"}-`,
    maxRunning: options.maxRunning ?? 2,
    tags: ["post"],
    key: (work) => work,
    // Real kinds no longer offer work they closed.
    waiting: async () => (options.waiting ?? []).filter((work) => !closed.some((c) => c.work === work && c.outcome === "closed")),
    ...(options.held && { held: async () => options.held! }),
    prepare: async (work) => (options.skip?.includes(work) ? null : { prompt: `check ${work}`, command: { model: "opus" } }),
    stopAt: (_work, startedAt) => startedAt + (options.stopAfterMs ?? 60 * MINUTE),
    ref: () => null,
    close: async (work, run) => {
      const outcome = options.outcome?.(run) ?? "closed";
      closed.push({ work, run, outcome });
      return outcome;
    },
  };
  return { kind, closed };
}

describe("the scheduler", () => {
  test("fills only the free slots", async () => {
    const world = fakeWorld();
    const { kind } = fakeKind({ waiting: ["a", "b", "c"], maxRunning: 2 });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    expect(world.started).toEqual(["cn-post-a", "cn-post-b"]);
    await scheduler.tick(false);
    expect(world.started).toHaveLength(2);
  });

  test("closes an ended job, records its cost, and starts the next", async () => {
    const world = fakeWorld();
    const { kind, closed } = fakeKind({ waiting: ["a", "b"], maxRunning: 1 });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    world.finish("cn-post-a");
    await scheduler.tick(false);
    expect(closed.map((c) => c.work)).toEqual(["a"]);
    expect(world.costRows).toEqual(["/runs/post/a"]);
    expect(world.failures).toEqual([null]);
    expect(world.started).toEqual(["cn-post-a", "cn-post-b"]);
  });

  test("starts nothing while Claudes may not start, but still closes what ends", async () => {
    const world = fakeWorld();
    const { kind, closed } = fakeKind({ waiting: ["a", "b"], maxRunning: 1 });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    world.setMayStart(false);
    world.finish("cn-post-a");
    await scheduler.tick(false);
    expect(closed).toHaveLength(1);
    expect(world.started).toEqual(["cn-post-a"]);
    expect(scheduler.running()).toBe(0);
  });

  test("retries a job once, and the retry waits while Claudes may not start", async () => {
    const world = fakeWorld();
    const { kind, closed } = fakeKind({ waiting: ["a"], maxRunning: 1, outcome: (run) => (run.attempt < 2 ? "retry" : "closed") });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    world.setMayStart(false);
    world.finish("cn-post-a");
    await scheduler.tick(false);
    expect(world.started).toEqual(["cn-post-a"]);
    world.setMayStart(true);
    await scheduler.tick(false);
    expect(world.started).toEqual(["cn-post-a", "cn-post-a"]);
    world.finish("cn-post-a");
    await scheduler.tick(false);
    expect(closed.map((c) => c.run.attempt)).toEqual([1, 2]);
  });

  test("stops a Claude at its time limit and tells the kind it timed out", async () => {
    const world = fakeWorld();
    const { kind, closed } = fakeKind({ waiting: ["a"], maxRunning: 1, stopAfterMs: -1 });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    world.setMayStart(false);
    await scheduler.tick(false);
    expect(world.stopped).toEqual(["cn-post-a"]);
    expect(closed[0]!.run.timedOut).toBe(true);
    expect(world.failures[0]).toContain("time limit");
  });

  test("never starts work it gave up on again", async () => {
    const world = fakeWorld();
    const { kind } = fakeKind({ waiting: ["a"], maxRunning: 1, outcome: () => "gave_up" });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    world.finish("cn-post-a");
    await scheduler.tick(false);
    await scheduler.tick(false);
    expect(world.started).toEqual(["cn-post-a"]);
  });

  test("after a restart, picks up a Claude still at work and closes one that ended", async () => {
    const world = fakeWorld();
    world.alive.add("cn-post-a");
    const { kind, closed } = fakeKind({ held: ["a", "b"], maxRunning: 5 });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    expect(closed.map((c) => c.work)).toEqual(["b"]);
    expect(scheduler.running()).toBe(1);
    expect(world.started).toEqual([]);
  });

  test("a skipped job takes no slot and no session", async () => {
    const world = fakeWorld();
    const { kind } = fakeKind({ waiting: ["a", "b"], maxRunning: 2, skip: ["a"] });
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    expect(world.started).toEqual(["cn-post-b"]);
  });

  test("a job that cannot start counts towards the failure alert", async () => {
    const world = fakeWorld();
    const { kind } = fakeKind({ waiting: ["a"], maxRunning: 1 });
    kind.prepare = async () => {
      throw new Error("the post could not be read");
    };
    const scheduler = createScheduler(world.deps([kind]));
    await scheduler.tick(true);
    expect(world.started).toEqual([]);
    expect(world.failures[0]).toContain("the post could not be read");
  });

  test("fills the kinds in their order", async () => {
    const world = fakeWorld();
    const tweets = fakeKind({ name: "tweet", waiting: ["t"], maxRunning: 1 });
    const posts = fakeKind({ name: "post", waiting: ["p"], maxRunning: 1 });
    const scheduler = createScheduler(world.deps([tweets.kind, posts.kind]));
    await scheduler.tick(true);
    expect(world.started).toEqual(["cn-tweet-t", "cn-post-p"]);
  });
});
