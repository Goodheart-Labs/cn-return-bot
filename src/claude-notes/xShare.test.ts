import { describe, expect, test } from "bun:test";
import { computeXShare, xShareProblem, type XShareSnapshot } from "./xShare";
import { MAX_WEEKLY_USAGE_PERCENT } from "../everything/usagePacing";

const HOUR = 3600_000;
const now = new Date("2026-10-27T12:00:00Z");

/** One WSDM Cup tweet's run and one Common Notes post's run with these API
 *  costs. */
const costs = (xCostUsd: number, commonNotesCostUsd: number) => [
  { tags: ["x-wsdm", "tweet"], apiCostUsd: xCostUsd },
  { tags: ["common-notes", "post"], apiCostUsd: commonNotesCostUsd },
];

/** Halfway through the week, so the WSDM Cup account may have used 15% by now. */
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
    const share = computeXShare(snapshot(), "wsdm");
    expect(share).toEqual({ kind: "measured", account: "wsdm", usedPercent: 4, allowedPercent: 15 });
    expect(xShareProblem(share)).toBeNull();
  });

  test("splits only the usage that rose since costs were first recorded", () => {
    expect(computeXShare(snapshot({ weeklyBeforeCosts: 30 }), "wsdm")).toEqual({ kind: "measured", account: "wsdm", usedPercent: 1, allowedPercent: 15 });
  });

  test("is unavailable once X used more than its allowance so far", () => {
    expect(xShareProblem(computeXShare(snapshot({ runs: costs(40, 60) }), "wsdm"))).toContain("X account wsdm has used 16.00%");
  });

  test("counts only the WSDM Cup account's own runs against its share", () => {
    const runs = [...costs(10, 80), { tags: ["x", "tweet"], apiCostUsd: 10 }];
    expect(computeXShare(snapshot({ runs }), "wsdm")).toMatchObject({ usedPercent: 4, allowedPercent: 15 });
  });

  test("lets the first account use only what the WSDM Cup account leaves of its share", () => {
    const runs = [...costs(10, 80), { tags: ["x", "tweet"], apiCostUsd: 10 }];
    expect(computeXShare(snapshot({ runs }), "stilt")).toMatchObject({ usedPercent: 8, allowedPercent: 15 });
    // The WSDM Cup account used 16% of the 15% it may use by now, so the first account gets nothing.
    expect(xShareProblem(computeXShare(snapshot({ runs: costs(40, 60) }), "stilt"))).toContain("X accounts stilt and wsdm together have used 16.00%");
  });

  test("lets X start right after the reset, before any run has a cost", () => {
    const justReset = snapshot({ weekly: 0, runs: [] });
    justReset.latest!.weeklyResetsAt = new Date(now.getTime() + 167 * HOUR);
    expect(xShareProblem(computeXShare(justReset, "wsdm"))).toBeNull();
  });

  test("is unavailable when the runner stopped reporting", () => {
    const stale = snapshot();
    stale.latest!.at = new Date(now.getTime() - 31 * 60_000);
    expect(computeXShare(stale, "wsdm").kind).toBe("runner_down");
    expect(computeXShare(snapshot({ latest: null }), "wsdm").kind).toBe("runner_down");
  });

  test("is unavailable when the runner would not start a Claude", () => {
    expect(computeXShare(snapshot({ weekly: MAX_WEEKLY_USAGE_PERCENT }), "wsdm").kind).toBe("runner_down");
  });
});
