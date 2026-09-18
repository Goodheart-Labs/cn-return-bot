import { describe, expect, test } from "bun:test";
import { retryEligibleTweetIds, type RunRow } from "./retryableFailures";

const now = Date.parse("2026-09-18T01:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const run = (tweet_id: string, minutesAgo: number, outcome = "failed", outcome_reason: string | null = "bot_error"): RunRow =>
  ({ tweet_id, outcome, outcome_reason, created_at: ago(minutesAgo) });

describe("retryEligibleTweetIds", () => {
  test("one transient failure past the cooldown earns one retry", () => {
    const eligible = retryEligibleTweetIds([
      run("a", 40),
      run("b", 90, "failed", "model_output_invalid"),
    ], now);
    expect([...eligible].sort()).toEqual(["a", "b"]);
  });

  test("final outcomes, second failures, fresh failures and stale tweets stay out", () => {
    const eligible = retryEligibleTweetIds([
      run("sources", 40, "failed", "unfetchable_sources"),
      run("swept", 200, "failed", "not_completed"),
      run("twice", 40), run("twice", 400),
      run("fresh", 5),
      run("stale", 49 * 60),
      run("rejected", 40, "rejected", "prefilter_no_note"),
      run("mixed", 400), run("mixed", 40, "in_progress", null),
      run("noted", 400), run("noted", 300, "submitted", null),
    ], now);
    expect([...eligible]).toEqual([]);
  });

  test("rows outside the window are ignored when counting attempts", () => {
    // A failure from days ago does not use up the tweet's retry now.
    const eligible = retryEligibleTweetIds([run("old-then-new", 3 * 24 * 60), run("old-then-new", 45)], now);
    expect([...eligible]).toEqual(["old-then-new"]);
  });
});
