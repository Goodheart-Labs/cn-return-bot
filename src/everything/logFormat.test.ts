import { afterEach, describe, expect, test } from "bun:test";
import { clip, duration, group, ordinal, table, tally } from "./logFormat";

/* The run log is the only window into what the pipeline did, so its formatting
 * is worth pinning down. The collapsing behaviour in particular differs
 * between CI and a terminal, and getting it wrong on CI means an unreadable
 * wall of text rather than a visible error. */

const originalCi = process.env.CI;
afterEach(() => {
  if (originalCi === undefined) delete process.env.CI;
  else process.env.CI = originalCi;
});

describe("group", () => {
  test("wraps the body in GitHub's collapsible markers on CI", () => {
    process.env.CI = "true";
    expect(group("all 2 checks", ["a", "b"])).toBe("::group::all 2 checks\na\nb\n::endgroup::");
  });

  test("degrades to a plain header line locally", () => {
    delete process.env.CI;
    expect(group("all 2 checks", ["a", "b"])).toBe("  all 2 checks\na\nb");
  });

  test("an empty body renders nothing, so a silent section leaves no trace", () => {
    process.env.CI = "true";
    expect(group("nothing here", [])).toBe("");
  });
});

describe("table", () => {
  test("pads every column to its widest cell and right-aligns where asked", () => {
    const lines = table(["rank", "creator"], [["1", "zvi"], ["10", "slowboring"]], ["right", "left"]);
    expect(lines).toEqual([
      "     rank  creator",
      "        1  zvi",
      "       10  slowboring",
    ]);
  });

  test("trailing padding is trimmed, so no line carries invisible spaces", () => {
    for (const line of table(["a", "b"], [["x", "y"]])) expect(line).toBe(line.trimEnd());
  });
});

describe("duration", () => {
  test("seconds below a minute", () => {
    expect(duration(45_000)).toBe("45s");
  });

  test("minutes and seconds, zero padded", () => {
    expect(duration(192_000)).toBe("3m12s");
    expect(duration(65_000)).toBe("1m05s");
  });

  test("hours and minutes past an hour", () => {
    expect(duration(3_900_000)).toBe("1h05m");
  });
});

describe("ordinal", () => {
  test("the usual suffixes", () => {
    expect([1, 2, 3, 4, 21].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "21st"]);
  });

  test("the teens are all th", () => {
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
  });
});

describe("clip", () => {
  test("leaves a short title alone", () => {
    expect(clip("short", 20)).toBe("short");
  });

  test("cuts on a word boundary when there is a sensible one", () => {
    expect(clip("GPT 6 Astra, so good even OpenAI are worried", 20)).toBe("GPT 6 Astra, so…");
  });

  test("cuts mid-word rather than lose most of the title", () => {
    expect(clip("Supercalifragilisticexpialidocious", 10)).toBe("Supercali…");
  });
});

describe("tally", () => {
  test("renders counts biggest first", () => {
    expect(tally(new Map([["natesilver", 7], ["slowboring", 16]]))).toBe("slowboring 16, natesilver 7");
  });
});
