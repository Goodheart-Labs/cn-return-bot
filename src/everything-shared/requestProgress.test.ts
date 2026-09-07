import { describe, expect, test } from "bun:test";
import {
  deriveRequestProgress,
  progressIsTerminal,
  progressLines,
  type ProgressClaimRow,
  type ProgressItemRow,
  type RequestStatusRow,
} from "./requestProgress";

/* These tests cover the mapping from database rows to the card's state, one
 * branch per test, plus the display strings the states render as. */

const item = (overrides: Partial<ProgressItemRow> = {}): ProgressItemRow => ({
  id: "item-1",
  status: "queued",
  checked_scope: "page",
  progress: null,
  ...overrides,
});

const claim = (status: ProgressClaimRow["status"], id: string = status): ProgressClaimRow => ({ id, status });

const request = (overrides: Partial<RequestStatusRow> = {}): RequestStatusRow => ({
  status: "pending",
  status_reason: null,
  item_id: null,
  ...overrides,
});

describe("deriveRequestProgress", () => {
  test("nothing visible at all is unavailable", () => {
    expect(deriveRequestProgress(null, [], null)).toEqual({ kind: "unavailable" });
  });

  test("a pending request with no item yet is saved", () => {
    expect(deriveRequestProgress(null, [], request())).toEqual({ kind: "saved" });
  });

  test("a resolved request whose item row has not arrived yet is still saved", () => {
    expect(deriveRequestProgress(null, [], request({ status: "enqueued" }))).toEqual({ kind: "saved" });
  });

  test("a request the intake errored is failed", () => {
    expect(deriveRequestProgress(null, [], request({ status: "error" }))).toEqual({ kind: "failed" });
  });

  test("a request the intake skipped is failed", () => {
    expect(deriveRequestProgress(null, [], request({ status: "skipped" }))).toEqual({ kind: "failed" });
  });

  test("a queued item is waiting in line", () => {
    expect(deriveRequestProgress(item(), [], request())).toEqual({ kind: "queued" });
  });

  test("a queued item stamped budget_exhausted shows the budget state", () => {
    const row = item({ progress: { stage: "budget_exhausted" } });
    expect(deriveRequestProgress(row, [], null)).toEqual({ kind: "budget" });
  });

  test("a processing item with no stamped stage is read as extracting", () => {
    const row = item({ status: "processing" });
    expect(deriveRequestProgress(row, [], null)).toEqual({ kind: "extracting" });
  });

  test("a processing item stamped extracting is extracting", () => {
    const row = item({ status: "processing", progress: { stage: "extracting" } });
    expect(deriveRequestProgress(row, [], null)).toEqual({ kind: "extracting" });
  });

  test("a checking item counts finished claims and written notes", () => {
    const row = item({ status: "processing", progress: { stage: "checking", total: 6 } });
    const claims = [claim("note"), claim("no_note"), claim("error"), claim("pending"), claim("pending", "p2")];
    expect(deriveRequestProgress(row, claims, null)).toEqual({ kind: "checking", done: 3, total: 6, notes: 1 });
  });

  test("skipped claims count neither as finished nor toward the total", () => {
    const row = item({ status: "processing", progress: { stage: "checking", total: 2 } });
    const claims = [claim("note"), claim("skipped"), claim("pending")];
    expect(deriveRequestProgress(row, claims, null)).toEqual({ kind: "checking", done: 1, total: 2, notes: 1 });
  });

  test("claim rows outnumbering the stamped total raise the total", () => {
    const row = item({ status: "processing", progress: { stage: "checking", total: 1 } });
    const claims = [claim("note"), claim("pending")];
    expect(deriveRequestProgress(row, claims, null)).toEqual({ kind: "checking", done: 1, total: 2, notes: 1 });
  });

  test("claims existing without a stamped stage still count as checking", () => {
    const row = item({ status: "processing" });
    expect(deriveRequestProgress(row, [claim("pending")], null)).toEqual({
      kind: "checking",
      done: 0,
      total: 1,
      notes: 0,
    });
  });

  test("a done item reports how many notes were written", () => {
    const claims = [claim("note"), claim("note", "n2"), claim("no_note")];
    expect(deriveRequestProgress(item({ status: "done" }), claims, null)).toEqual({ kind: "done", notes: 2 });
  });

  test("a done item outranks a skipped request, so an already-checked page reads as done", () => {
    const progress = deriveRequestProgress(item({ status: "done" }), [claim("note")], request({ status: "skipped" }));
    expect(progress).toEqual({ kind: "done", notes: 1 });
  });

  test("an errored item is failed", () => {
    expect(deriveRequestProgress(item({ status: "error" }), [], null)).toEqual({ kind: "failed" });
  });
});

describe("progressIsTerminal", () => {
  test("done, failed and unavailable are terminal", () => {
    expect(progressIsTerminal({ kind: "done", notes: 0 })).toBe(true);
    expect(progressIsTerminal({ kind: "failed" })).toBe(true);
    expect(progressIsTerminal({ kind: "unavailable" })).toBe(true);
  });

  test("the live states are not, budget included", () => {
    expect(progressIsTerminal({ kind: "saved" })).toBe(false);
    expect(progressIsTerminal({ kind: "queued" })).toBe(false);
    expect(progressIsTerminal({ kind: "budget" })).toBe(false);
    expect(progressIsTerminal({ kind: "extracting" })).toBe(false);
    expect(progressIsTerminal({ kind: "checking", done: 0, total: 1, notes: 0 })).toBe(false);
  });
});

describe("progressLines", () => {
  test("checking shows the tally, and the note line only once a note exists", () => {
    expect(progressLines({ kind: "checking", done: 2, total: 6, notes: 0 })).toEqual(["2 of 6 claims checked"]);
    expect(progressLines({ kind: "checking", done: 2, total: 6, notes: 1 })).toEqual([
      "2 of 6 claims checked",
      "1 note written",
    ]);
  });

  test("done pluralizes the note count and has a wording for zero notes", () => {
    expect(progressLines({ kind: "done", notes: 3 })).toEqual(["3 notes written"]);
    expect(progressLines({ kind: "done", notes: 1 })).toEqual(["1 note written"]);
    expect(progressLines({ kind: "done", notes: 0 })).toEqual(["checked, nothing to note"]);
  });

  test("every state has lines and none of them carries an em dash", () => {
    const states = [
      { kind: "saved" },
      { kind: "queued" },
      { kind: "budget" },
      { kind: "extracting" },
      { kind: "checking", done: 1, total: 2, notes: 1 },
      { kind: "done", notes: 1 },
      { kind: "failed" },
      { kind: "unavailable" },
    ] as const;
    for (const state of states) {
      const lines = progressLines(state);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toInclude("—");
    }
  });
});
