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

/** Halfway through the week, so the WSDM Cup account may have used 30% by now. */
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
    expect(share).toEqual({ kind: "measured", account: "wsdm", usedPercent: 4, allowedPercent: 30 });
    expect(xShareProblem(share)).toBeNull();
  });

  test("splits only the usage that rose since costs were first recorded", () => {
    expect(computeXShare(snapshot({ weeklyBeforeCosts: 30 }), "wsdm")).toEqual({ kind: "measured", account: "wsdm", usedPercent: 1, allowedPercent: 30 });
  });

  test("is unavailable once X used more than its allowance so far", () => {
    expect(xShareProblem(computeXShare(snapshot({ runs: costs(80, 20) }), "wsdm"))).toContain("X account wsdm has used 32.00%");
  });

  test("counts each account's runs only against its own share", () => {
    const runs = [...costs(10, 80), { tags: ["x", "tweet"], apiCostUsd: 10 }];
    expect(computeXShare(snapshot({ runs }), "wsdm")).toMatchObject({ usedPercent: 4, allowedPercent: 30 });
    expect(computeXShare(snapshot({ runs }), "stilt")).toMatchObject({ usedPercent: 4 });
    expect(computeXShare(snapshot({ runs: costs(10, 90) }), "stilt")).toMatchObject({ usedPercent: 0 });
  });

  test("gives the first account no share, because it writes no notes", () => {
    expect(xShareProblem(computeXShare(snapshot({ runs: costs(10, 90) }), "stilt"))).toContain("may use 0.00% by now");
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
