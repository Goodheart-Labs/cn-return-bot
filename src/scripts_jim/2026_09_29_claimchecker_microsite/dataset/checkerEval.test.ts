import { describe, expect, test } from "bun:test";
import { rowVerdictOf, verdictOf } from "./checkerEval";
import type { CheckerOutcome } from "./evalTypes";

const note: CheckerOutcome = { type: "note", note: "A note.", sources: [] };
const noNote: CheckerOutcome = { type: "no_note", reason: "no_correction_needed" };
const error: CheckerOutcome = { type: "error", error: "boom" };

describe("verdictOf", () => {
  test("a note is a pass where a note is expected and a fail where it is not", () => {
    expect(verdictOf({ decision: "note" }, note)).toBe("pass");
    expect(verdictOf({ decision: "no_note" }, note)).toBe("fail");
  });

  test("no note is a pass where none is expected and a fail where a note is", () => {
    expect(verdictOf({ decision: "no_note" }, noNote)).toBe("pass");
    expect(verdictOf({ decision: "note" }, noNote)).toBe("fail");
  });

  test("a note that would not be bad is a soft fail, not a fail", () => {
    expect(verdictOf({ decision: "no_note", noteTolerated: true }, note)).toBe("soft_fail");
  });

  test("an error is never read as a decision", () => {
    expect(verdictOf({ decision: "note" }, error)).toBe("error");
    expect(verdictOf({ decision: "no_note" }, error)).toBe("error");
  });
});

describe("rowVerdictOf", () => {
  test("passes when two of three samples passed", () => {
    expect(rowVerdictOf(["pass", "fail", "pass"])).toEqual({ passedIn: 2, verdict: "pass" });
  });

  test("fails when only one passed", () => {
    expect(rowVerdictOf(["fail", "pass", "fail"])).toEqual({ passedIn: 1, verdict: "fail" });
  });

  test("reports the way the samples most often went wrong", () => {
    expect(rowVerdictOf(["soft_fail", "soft_fail", "pass"]).verdict).toBe("soft_fail");
    expect(rowVerdictOf(["soft_fail", "soft_fail", "fail"]).verdict).toBe("soft_fail");
    expect(rowVerdictOf(["error", "error", "pass"]).verdict).toBe("error");
    expect(rowVerdictOf(["fail", "fail", "error"]).verdict).toBe("fail");
  });

  test("a plain fail when the samples disagree and too few passed", () => {
    expect(rowVerdictOf(["error", "soft_fail", "fail"]).verdict).toBe("fail");
  });
});
