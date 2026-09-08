import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { SupabaseLogger } from "./supabaseClient";

const now = Date.parse("2026-09-07T12:00:00Z");
const dayMs = 86_400_000;

function history(rows: { submit_score: number; decided_at: string }[]) {
  const query = {
    select: mock(() => query),
    eq: mock(() => query),
    gte: mock(() => query),
    order: mock(() => query),
    range: mock(async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null })),
  };
  const logger = Object.assign(Object.create(SupabaseLogger.prototype), { client: { from: mock(() => query) } }) as SupabaseLogger;
  return { logger, query };
}

afterEach(() => mock.restore());

describe("fetchRankingSubmitScores", () => {
  test("returns a fractional span independently of distinct UTC dates", async () => {
    spyOn(Date, "now").mockReturnValue(now);
    const { logger, query } = history(Array.from({ length: 5 }, (_, i) => ({
      submit_score: i,
      decided_at: new Date(now - (4.25 - i) * dayMs).toISOString(),
    })));
    expect(await logger.fetchRankingSubmitScores("flags_then_eval", 7)).toEqual({ scores: [0, 1, 2, 3, 4], spanDays: 4.25, distinctDays: 5 });
    expect(query.eq).toHaveBeenCalledWith("scorer", "flags_then_eval");
    expect(query.gte).toHaveBeenCalledWith("decided_at", new Date(now - 7 * dayMs).toISOString());
  });

  test("caps a paginated seven-day window touching eight dates at seven days", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(now);
    const { logger, query } = history(Array.from({ length: 1001 }, (_, i) => ({
      submit_score: i,
      decided_at: new Date(now - 7 * dayMs + i * 7 * dayMs / 1000).toISOString(),
    })));
    clock.mockReturnValueOnce(now).mockReturnValue(now + 1000);
    const result = await logger.fetchRankingSubmitScores("flags_then_eval", 7);
    expect(result.scores).toHaveLength(1001);
    expect(result.spanDays).toBe(7);
    expect(result.distinctDays).toBe(8);
    expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  test("empty history has zero span and zero distinct dates", async () => {
    const { logger } = history([]);
    expect(await logger.fetchRankingSubmitScores("flags_then_eval", 7)).toEqual({ scores: [], spanDays: 0, distinctDays: 0 });
  });
});
