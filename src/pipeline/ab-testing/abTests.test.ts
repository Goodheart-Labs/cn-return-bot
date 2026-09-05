import { describe, expect, test } from "bun:test";
import { runABTests, withForcedPicks, resolvePicks } from "./abTests";
import { AB_TESTS } from "./abTestsData";

describe("writer_last_check test", () => {
  test("forced on sets writer_last_check on the config", () => {
    const { config, picks } = withForcedPicks(
      { bot: "simple-bot", writer_last_check: "on" },
      () => runABTests(AB_TESTS),
    );
    expect(picks.writer_last_check).toBe("on");
    expect(config.writer_last_check).toBe(true);
  });

  test("forced off leaves writer_last_check false", () => {
    const { config, picks } = withForcedPicks(
      { bot: "simple-bot", writer_last_check: "off" },
      () => runABTests(AB_TESTS),
    );
    expect(picks.writer_last_check).toBe("off");
    expect(config.writer_last_check).toBe(false);
  });

  test("a simple-bot run always records a pick for it", () => {
    const { picks } = withForcedPicks({ bot: "simple-bot" }, () => runABTests(AB_TESTS));
    expect(picks.writer_last_check).toMatch(/^(on|off)$/);
  });

  test("resolvePicks leaves it unset on old rows, since it has prerequisites", () => {
    expect(resolvePicks({ bot: "simple-bot" }).writer_last_check).toBeUndefined();
  });
});
