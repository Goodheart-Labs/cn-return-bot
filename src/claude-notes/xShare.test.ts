import { describe, expect, test } from "bun:test";
import { computeXShare, xShareProblem, type XShareSnapshot } from "./xShare";
import { MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";

const HOUR = 3600_000;
const now = new Date("2026-10-27T12:00:00Z");

/** One X tweet's run and one Common Notes post's run with these API costs. */
const costs = (xCostUsd: number, commonNotesCostUsd: number) => [
  { tags: ["x", "tweet"], apiCostUsd: xCostUsd },
  { tags: ["common-notes", "post"], apiCostUsd: commonNotesCostUsd },
];

/** Halfway through the week, so X may have used 15% by now. */
function snapshot(overrides: Partial<XShareSnapshot> & { weekly?: number } = {}): XShareSnapshot {
  const { weekly = 40, ...rest } = overrides;
  return {
    now,
    latest: { at: new Date(now.getTime() - 5 * 60_000), weekly, weeklyResetsAt: new Date(now.getTime() + 84 * HOUR) },
    runs: costs(10, 90),
    weeklyBeforeCosts: 0,
    ...rest,
  };
}

describe("computeXShare", () => {
  test("splits the week's usage by the cost of the runs", () => {
    const share = computeXShare(snapshot(), "stilt");
    expect(share).toEqual({ kind: "measured", account: "stilt", usedPercent: 4, allowedPercent: 15 });
    expect(xShareProblem(share)).toBeNull();
  });

  test("splits only the usage that rose since costs were first recorded", () => {
    expect(computeXShare(snapshot({ weeklyBeforeCosts: 30 }), "stilt")).toEqual({ kind: "measured", account: "stilt", usedPercent: 1, allowedPercent: 15 });
  });

  test("is unavailable once X used more than its allowance so far", () => {
    expect(xShareProblem(computeXShare(snapshot({ runs: costs(40, 60) }), "stilt"))).toContain("X account stilt has used 16.00%");
  });

  test("counts each account's runs only against its own share", () => {
    const runs = [...costs(10, 80), { tags: ["x-wsdm", "tweet"], apiCostUsd: 10 }];
    expect(computeXShare(snapshot({ runs }), "stilt")).toMatchObject({ usedPercent: 4, allowedPercent: 15 });
    expect(computeXShare(snapshot({ runs }), "wsdm")).toMatchObject({ usedPercent: 4, allowedPercent: 15 });
    expect(computeXShare(snapshot({ runs: costs(10, 90) }), "wsdm")).toMatchObject({ usedPercent: 0 });
  });

  test("lets X start right after the reset, before any run has a cost", () => {
    const justReset = snapshot({ weekly: 0, runs: [] });
    justReset.latest!.weeklyResetsAt = new Date(now.getTime() + 167 * HOUR);
    expect(xShareProblem(computeXShare(justReset, "stilt"))).toBeNull();
  });

  test("is unavailable when the runner stopped reporting", () => {
    const stale = snapshot();
    stale.latest!.at = new Date(now.getTime() - 31 * 60_000);
    expect(computeXShare(stale, "stilt").kind).toBe("runner_down");
    expect(computeXShare(snapshot({ latest: null }), "stilt").kind).toBe("runner_down");
  });

  test("is unavailable when the runner would not start a Claude", () => {
    expect(computeXShare(snapshot({ weekly: MAX_WEEKLY_USAGE_PERCENT }), "stilt").kind).toBe("runner_down");
  });
});
