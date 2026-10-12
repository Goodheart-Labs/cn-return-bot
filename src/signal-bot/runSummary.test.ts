import { afterEach, describe, expect, test } from "bun:test";
import type { SubmissionCapacity } from "../pipeline/capacity/submissionReserve";
import { RunSummaries, formatRunSummary, groupCycles, type PipelineRunRow } from "./runSummary";
import { SignalStore } from "./store";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

const capacity: SubmissionCapacity = { cap: 17, probe: true, reserve: 0, used24h: 17, inFlight: 0, canSubmit: true, remaining: 0, signalQueued: 1, nextAttemptAt: null } as SubmissionCapacity;
function row(created_at: string, outcome: string, extra: Partial<PipelineRunRow> = {}): PipelineRunRow {
  return { tweet_id: `t${created_at}`, created_at, outcome, ...extra };
}

describe("run summaries", () => {
  test("groups rows into scheduled runs and formats where each tweet stopped", () => {
    const rows = [
      row("2026-09-17T18:49:00.000Z", "rejected", { outcome_reason: "check_failed", final_stage: "check" }),
      row("2026-09-17T18:21:00.000Z", "rejected", { outcome_reason: "prefilter_no_note", final_stage: "prefilter" }),
      row("2026-09-17T18:50:30.000Z", "submitted", { final_stage: "submission" }),
      row("2026-09-17T18:52:00.000Z", "rejected", { outcome_reason: "check_failed", final_stage: "check" }),
    ];
    const cycles = groupCycles(rows);
    expect(cycles.map((cycle) => cycle.length)).toEqual([1, 3]);
    const text = formatRunSummary(cycles[1]!, capacity, Date.parse("2026-09-17T19:10:00.000Z"));
    expect(text.split("\n")).toEqual([
      "Run 18:49 UTC (11:49 PT) · 3 tweets processed · 1 note posted",
      "- 2 rejected at check (check_failed)",
      "- 1 submitted at submission",
      "Writing limit: 17/17 used in 24h · 0 remaining · probe mode (one attempt allowed to test the limit) · 1 Signal note queued",
    ]);
  });

  test("posts settled runs oldest first, waits for runs still in progress, and reports stuck rows", async () => {
    const store = new SignalStore(":memory:", "summary-test");
    cleanups.push(() => store.close());
    let clock = Date.parse("2026-09-17T19:00:00.000Z");
    const rows: PipelineRunRow[] = [
      row("2026-09-17T18:21:00.000Z", "rejected", { outcome_reason: "prefilter_no_note", final_stage: "prefilter" }),
      row("2026-09-17T18:49:00.000Z", "in_progress", { final_stage: "started" }),
    ];
    const sent: string[] = [];
    const summaries = new RunSummaries({
      store, now: () => new Date(clock), lookbackMs: 3 * 3600_000,
      listRunsSince: async (since) => rows.filter((r) => r.created_at >= since),
      capacity: async () => capacity,
      send: async (text) => { sent.push(text); },
    });
    expect(await summaries.poll()).toBe(1);
    expect(sent[0]).toStartWith("Run 18:21 UTC (11:21 PT) · 1 tweet processed · 0 notes posted\n- 1 rejected at prefilter (prefilter_no_note)");
    // The 18:49 run is still in progress and recent: wait.
    expect(await summaries.poll()).toBe(0);
    rows[1] = row("2026-09-17T18:49:00.000Z", "rejected", { outcome_reason: "check_failed", final_stage: "check" });
    clock = Date.parse("2026-09-17T18:53:00.000Z");
    expect(await summaries.poll()).toBe(0); // newest row younger than the settle window
    clock = Date.parse("2026-09-17T19:00:00.000Z");
    expect(await summaries.poll()).toBe(1);
    expect(sent[1]).toContain("- 1 rejected at check (check_failed)");
    // A run whose only row stays in progress for too long is reported as stuck.
    rows.push(row("2026-09-17T19:21:00.000Z", "in_progress", { final_stage: "started" }));
    clock = Date.parse("2026-09-17T19:50:00.000Z");
    expect(await summaries.poll()).toBe(1);
    expect(sent[2]).toContain("still marked in progress after 25 min");
    expect(await summaries.poll()).toBe(0);
  });
});
