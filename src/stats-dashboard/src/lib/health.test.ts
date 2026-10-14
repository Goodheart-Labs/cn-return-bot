import { describe, expect, test } from "bun:test";
import {
  buildPipelineHealth,
  healthAlerts,
  summarizeHealthPeriod,
  type HealthCapacity,
  type HealthRun,
  type PipelineHealth,
} from "./health";

const AS_OF = Date.parse("2026-09-15T20:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const capacity: HealthCapacity = {
  canSubmit: true,
  signalQueued: 0,
  inFlight: 0,
  used24h: 4,
  nextAttemptAt: null,
  probe: false,
};

function run(overrides: Partial<HealthRun> = {}): HealthRun {
  return {
    id: "run-1",
    tweet_id: "tweet-1",
    created_at: new Date(AS_OF - HOUR).toISOString(),
    outcome: "rejected",
    outcome_reason: "prefilter_no_note",
    final_stage: "prefilter",
    commit_sha: "abc123",
    prefilter_elapsed_ms: null,
    prefilter_timeout: null,
    ...overrides,
  };
}

function health(runs: HealthRun[] = [], overrides: Partial<PipelineHealth> = {}): PipelineHealth {
  return {
    ...buildPipelineHealth({
      runs,
      asOf: new Date(AS_OF),
      latestAttemptAt: new Date(AS_OF - HOUR).toISOString(),
      latestSubmissionAt: new Date(AS_OF - HOUR).toISOString(),
      overdueTotal: 0,
      capacity,
    }),
    ...overrides,
  };
}

function periodWithFailures(failures: number, total: number) {
  return summarizeHealthPeriod(Array.from({ length: total }, (_, index) =>
    run({ outcome: index < failures ? "failed" : "rejected" })), AS_OF);
}

describe("summarizeHealthPeriod", () => {
  test("normal filtering completes decisions, technical rejections fail, and fresh work is excluded", () => {
    const summary = summarizeHealthPeriod([
      run({ outcome: "submitted" }),
      run({ outcome: "candidate" }),
      run(),
      run({ outcome: "filtered" }),
      run({ outcome: "failed", outcome_reason: "check_error" }),
      run({ outcome: "rejected", outcome_reason: "submit_error" }),
      run({ outcome: "in_progress", created_at: new Date(AS_OF - 30 * MINUTE).toISOString() }),
      run({ outcome: "in_progress", created_at: new Date(AS_OF - 30 * MINUTE + 1).toISOString() }),
      run({ outcome: null }),
      run({ outcome: "unrecognized_outcome" }),
    ], AS_OF);

    expect(summary).toMatchObject({
      attempts: 10,
      completed: 4,
      failed: 2,
      overdue: 1,
      active: 1,
      unknown: 2,
      submitted: 1,
      candidates: 1,
      rejected: 2,
      filtered: 1,
      completionRate: 4 / 7,
    });
  });

  test("absence of assessed decisions or precheck timing stays unknown", () => {
    expect(summarizeHealthPeriod([], AS_OF)).toMatchObject({
      completionRate: null, precheckSamples: 0, precheckMedianMs: null, precheckP90Ms: null,
    });
    const summary = summarizeHealthPeriod([
      run({ outcome: null }),
      run({ outcome: "in_progress", created_at: new Date(AS_OF).toISOString() }),
      run({ outcome: "in_progress", created_at: "invalid" }),
    ], AS_OF);
    expect(summary).toMatchObject({ completionRate: null, active: 1, unknown: 2 });
  });

  test("measures only valid elapsed values and counts fail-open separately from failed outcomes", () => {
    const invalid = [null, "", "  ", "unknown", NaN, Infinity, -1, "-2"];
    const summary = summarizeHealthPeriod([
      ...invalid.map((value) => run({ prefilter_elapsed_ms: value })),
      run({ prefilter_elapsed_ms: "1000" }),
      run({ prefilter_elapsed_ms: 3000, prefilter_timeout: true }),
      run({ prefilter_elapsed_ms: 5000, prefilter_timeout: { action: "other" } }),
      run({ prefilter_elapsed_ms: 9000, prefilter_timeout: { action: "fail_open" } }),
      run({ prefilter_timeout: { action: "fail_open" } }),
    ], AS_OF);
    expect(summary).toMatchObject({
      failed: 0,
      precheckSamples: 4,
      precheckTimeouts: 2,
      precheckMedianMs: 4000,
    });
    expect(summary.precheckP90Ms).toBeCloseTo(7800);
    expect(summarizeHealthPeriod([run({ prefilter_elapsed_ms: 0 })], AS_OF).precheckMedianMs).toBe(0);
  });
});

describe("buildPipelineHealth", () => {
  test("uses disjoint recent and seven-day baseline windows with exact boundaries", () => {
    const offsets = [-8 * DAY - 1, -8 * DAY, -DAY - 1, -DAY, 0, 1];
    const result = health(offsets.map((offset, index) => run({
      id: String(index), created_at: new Date(AS_OF + offset).toISOString(),
    })));
    expect(result.mode).toBe("snapshot");
    expect(result.generated_at).toBe(new Date(AS_OF).toISOString());
    expect(result.recent.attempts).toBe(2);
    expect(result.baseline.attempts).toBe(2);
    expect(result.reasons).toEqual([{ outcome: "rejected", reason: "prefilter_no_note", count: 2 }]);
  });

  test("preserves all-history overdue count independently from fetched recent rows", () => {
    const result = health([], { overdueTotal: 3 });
    expect(result.recent.overdue).toBe(0);
    expect(result.overdueTotal).toBe(3);
    expect(healthAlerts(result, AS_OF)).toContainEqual({
      severity: "error",
      message: "3 recorded attempts are still in progress after 30 minutes, including older history.",
    });
  });

  test("sorts reasons and bounds recent examples while preserving metadata and excluding extra logs", () => {
    const rows = Array.from({ length: 15 }, (_, index) => ({
      ...run({
        id: String(index),
        outcome: "failed",
        outcome_reason: index < 10 ? "bot_error" : "check_error",
        created_at: new Date(AS_OF - index * MINUTE).toISOString(),
      }),
      logs: { private: "must not be exported" },
    }));
    const result = health([
      ...rows,
      run({ id: "old", outcome: "failed", created_at: new Date(AS_OF - 2 * DAY).toISOString() }),
    ]);
    expect(result.reasons.map(({ reason, count }) => [reason, count])).toEqual([
      ["bot_error", 10], ["check_error", 5],
    ]);
    expect(result.examples).toHaveLength(12);
    expect(result.examples.map(({ id }) => id)).toEqual(Array.from({ length: 12 }, (_, index) => String(index)));
    expect(result.examples[0]).toEqual(run({
      id: "0", outcome: "failed", outcome_reason: "bot_error", created_at: new Date(AS_OF).toISOString(),
    }));
    expect(rows[0]!.logs).toEqual({ private: "must not be exported" });
  });

  test("includes overdue, fail-open, and slow examples without treating normal rejections as failures", () => {
    const result = health([
      run({ id: "ordinary" }),
      run({ id: "submit-error", outcome_reason: "submit_error" }),
      run({ id: "overdue", outcome: "in_progress" }),
      run({ id: "timeout", prefilter_timeout: { action: "fail_open" } }),
      run({ id: "slow", prefilter_elapsed_ms: "95001" }),
      run({ id: "boundary", prefilter_elapsed_ms: 95000 }),
    ]);
    expect(result.examples.map(({ id }) => id).sort()).toEqual(["overdue", "slow", "submit-error", "timeout"]);
  });
});

describe("healthAlerts", () => {
  test("identifies an incompatible reserve response as a deployment error", () => {
    const result = health([], { capacity: null, capacityIssue: "legacy_reserve" });
    expect(healthAlerts(result, AS_OF)).toEqual([
      { severity: "error", message: expect.stringContaining("migration 100") },
    ]);
  });

  test("applies separate live and snapshot freshness limits", () => {
    const snapshot = health();
    expect(healthAlerts(snapshot, AS_OF + 6 * HOUR)).toEqual([]);
    expect(healthAlerts(snapshot, AS_OF + 6 * HOUR + 1).map(({ message }) => message)).toEqual([
      expect.stringContaining("over 6 hours old"),
    ]);
    const live = { ...snapshot, mode: "live" as const };
    expect(healthAlerts(live, AS_OF + 3 * MINUTE)).toEqual([]);
    expect(healthAlerts(live, AS_OF + 3 * MINUTE + 1)[0]?.message).toContain("over 3 minutes old");
    expect(healthAlerts({ ...snapshot, generated_at: "invalid" }, AS_OF)[0]?.message).toContain("timestamp is unavailable");
  });

  test("anchors inactivity to observed data and supplies capacity context", () => {
    const boundary = health([], { latestAttemptAt: new Date(AS_OF - 2 * HOUR).toISOString() });
    expect(healthAlerts(boundary, AS_OF)).toEqual([]);
    const idle = { ...boundary, latestAttemptAt: new Date(AS_OF - 2 * HOUR - 1).toISOString() };
    expect(healthAlerts(idle, AS_OF)[0]?.message).toContain("capacity is available");
    expect(healthAlerts({ ...idle, capacity: { ...capacity, canSubmit: false } }, AS_OF)[0]?.message).toContain("capacity is currently blocked");
    expect(healthAlerts({ ...idle, capacity: { ...capacity, signalQueued: 1 } }, AS_OF)[0]?.message).toContain("Signal notes");
    expect(healthAlerts(health([], { latestAttemptAt: null }), AS_OF)[0]?.message).toContain("No latest attempt");
  });

  test("requires three errors for a failure-rate warning and detects a clear baseline regression", () => {
    expect(healthAlerts(health([], { recent: periodWithFailures(2, 10) }), AS_OF)).toEqual([]);
    const highRate = healthAlerts(health([], { recent: periodWithFailures(3, 30) }), AS_OF);
    expect(highRate).toEqual([{ severity: "error", message: expect.stringContaining("10.0%") }]);
    const regressed = healthAlerts(health([], {
      recent: periodWithFailures(6, 100), baseline: periodWithFailures(1, 100),
    }), AS_OF);
    expect(regressed).toEqual([{ severity: "warning", message: expect.stringContaining("preceding seven days (1.0%)") }]);
    expect(healthAlerts(health([], {
      recent: periodWithFailures(6, 100), baseline: periodWithFailures(0, 19),
    }), AS_OF)).toEqual([]);
    expect(healthAlerts(health([], {
      recent: periodWithFailures(6, 100), baseline: periodWithFailures(2, 100),
    }), AS_OF)).toEqual([]);
  });

  test("includes overdue attempts in the technical failure denominator", () => {
    const recent = summarizeHealthPeriod([
      run({ outcome: "failed" }), run({ outcome: "failed" }), run({ outcome: "in_progress" }),
      run({ outcome: "in_progress", created_at: new Date(AS_OF).toISOString() }),
    ], AS_OF);
    expect(healthAlerts(health([], { recent }), AS_OF)[0]?.message).toContain("3 of 3");
  });

  test("surfaces unknown outcomes, unavailable capacity, and precheck problems without declaring health", () => {
    const result = health([
      run({ outcome: "unrecognized", prefilter_elapsed_ms: 95_001, prefilter_timeout: { action: "fail_open" } }),
      run({ outcome: null, created_at: new Date(AS_OF - 2 * DAY).toISOString() }),
    ], { capacity: null });
    const messages = healthAlerts(result, AS_OF).map(({ message }) => message);
    expect(messages).toHaveLength(4);
    expect(messages).toContainEqual(expect.stringContaining("p90 is 95.0 seconds"));
    expect(messages).toContainEqual(expect.stringContaining("timed out and failed open"));
    expect(messages).toContainEqual(expect.stringContaining("1 recent and 1 baseline"));
    expect(messages).toContainEqual(expect.stringContaining("capacity is unavailable"));
    expect(healthAlerts(health([run({ prefilter_elapsed_ms: 95_000 })]), AS_OF)).toEqual([]);
  });
});
