import { describe, expect, test } from "bun:test";
import { attemptLabel, failingSources } from "./retries";

describe("attemptLabel", () => {
  test("counts the listed attempts out of four", () => {
    expect(attemptLabel({ retries: 0 })).toBe("2/4");
    expect(attemptLabel({ retries: 2 })).toBe("4/4");
  });

  test("an attempt beyond the listed ones says the source was down", () => {
    expect(attemptLabel({ retries: 3 })).toBe("5, its source was down");
  });
});

describe("failingSources", () => {
  const o = (source: string, outcome: "failed" | "read" | "skipped") => ({ source, outcome });

  test("a source with two failures and nothing read is failing", () => {
    expect([...failingSources([o("youtube", "failed"), o("youtube", "failed"), o("youtube", "skipped"), o("substack", "read")])]).toEqual(["youtube"]);
  });

  test("one failure, or any post read, keeps the source going", () => {
    expect(failingSources([o("youtube", "failed"), o("substack", "failed"), o("substack", "failed"), o("substack", "read")]).size).toBe(0);
  });
});
