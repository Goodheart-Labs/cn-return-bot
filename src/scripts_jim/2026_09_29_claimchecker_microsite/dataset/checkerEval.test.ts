import { describe, expect, test } from "bun:test";
import { promptsOf, rowVerdictOf, verdictOf } from "./checkerEval";
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

describe("promptsOf", () => {
  const writerMessages = [
    { role: "system", content: "writer system" },
    { role: "user", content: "writer user" },
  ];

  test("reads the messages of a log written to disk, which are kept under string keys", () => {
    const logs = { note_writer_steps: { search: { messages: { "0": { userMessage: "research user" } } }, note_writer: { attempts: { "0": { messages: writerMessages } } } } };
    expect(promptsOf(logs)).toEqual({ research: "research user", writer: "writer user" });
  });

  test("reads the messages of a log held in memory, which are kept in lists", () => {
    const logs = { note_writer_steps: { search: { messages: [{ userMessage: "research user" }] }, note_writer: { attempts: [{ messages: writerMessages }] } } };
    expect(promptsOf(logs)).toEqual({ research: "research user", writer: "writer user" });
  });

  test("has no writer prompt for a check that ended before the writer", () => {
    const logs = { note_writer_steps: { search: { messages: { "0": { userMessage: "research user" } } } } };
    expect(promptsOf(logs)).toEqual({ research: "research user", writer: null });
  });
});
