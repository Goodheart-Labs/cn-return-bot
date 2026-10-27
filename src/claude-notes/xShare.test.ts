import { describe, expect, test } from "bun:test";
import { computeXShare, xShareHasRoom, type XShareSnapshot } from "./xShare";

const HOUR = 3600_000;
const now = new Date("2026-10-27T12:00:00Z");

/** Halfway through the week, so X may have used 10% by now. */
function snapshot(overrides: Partial<XShareSnapshot> & { weekly?: number } = {}): XShareSnapshot {
  const { weekly = 40, ...rest } = overrides;
  return {
    now,
    latest: { at: new Date(now.getTime() - 5 * 60_000), weekly, weeklyResetsAt: new Date(now.getTime() + 84 * HOUR) },
    xCostUsd: 10,
    commonNotesCostUsd: 90,
    weeklyBeforeCosts: 0,
    ...rest,
  };
}

describe("computeXShare", () => {
  test("splits the week's usage by the cost of the runs", () => {
    const share = computeXShare(snapshot());
    expect(share).toEqual({ kind: "measured", usedPercent: 4, allowedPercent: 10 });
    expect(xShareHasRoom(share)).toBe(true);
  });

  test("splits only the usage that rose since costs were first recorded", () => {
    expect(computeXShare(snapshot({ weeklyBeforeCosts: 30 }))).toEqual({ kind: "measured", usedPercent: 1, allowedPercent: 10 });
  });

  test("has no room once X used more than its allowance so far", () => {
    expect(xShareHasRoom(computeXShare(snapshot({ xCostUsd: 30, commonNotesCostUsd: 70 })))).toBe(false);
  });

  test("lets X start right after the reset, before any run has a cost", () => {
    const justReset = snapshot({ weekly: 0, xCostUsd: 0, commonNotesCostUsd: 0 });
    justReset.latest!.weeklyResetsAt = new Date(now.getTime() + 167 * HOUR);
    expect(xShareHasRoom(computeXShare(justReset))).toBe(true);
  });

  test("sends everything to the pipeline when the runner stopped reporting", () => {
    const stale = snapshot();
    stale.latest!.at = new Date(now.getTime() - 31 * 60_000);
    expect(computeXShare(stale).kind).toBe("runner_down");
    expect(computeXShare(snapshot({ latest: null })).kind).toBe("runner_down");
  });

  test("sends everything to the pipeline when the runner would not start a Claude", () => {
    expect(computeXShare(snapshot({ weekly: 90 })).kind).toBe("runner_down");
  });
});
