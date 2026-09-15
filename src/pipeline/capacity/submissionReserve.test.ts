import { computeMaxPosts } from "../orchestration/computeMaxPosts";
import { describe, expect, test } from "bun:test";
import { automaticGenerationPreflight, isUncertainSubmissionError, parseSubmissionAdmission, parseSubmissionCapacity } from "./submissionReserve";

const capacity = { cap: 10, used24h: 6, inFlight: 1, remaining: 3, reserve: 0,
  canSubmit: true, probe: false, signalQueued: 0, nextAttemptAt: null };

describe("automatic generation capacity preflight", () => {
  test("does not authorize paid generation without a database logger", async () => {
    expect((await automaticGenerationPreflight(null)).allowed).toBe(false);
  });

  test("a missing migration or failed capacity read closes generation instead of throwing", async () => {
    const result = await automaticGenerationPreflight({
      getNoteSubmissionCapacity: async () => { throw new Error("RPC does not exist"); },
    });
    expect(result).toMatchObject({ allowed: false, reason: expect.stringContaining("migration 100") });
  });

  test.each([null, 0, 2, 3])("an advisory estimate of %s remaining does not stop generation", async (remaining) => {
    const snapshot = { ...capacity, cap: remaining === null ? null : 10, remaining };
    const result = await automaticGenerationPreflight({ getNoteSubmissionCapacity: async () => snapshot });
    expect(result).toEqual({ allowed: true, capacity: snapshot });
    expect(computeMaxPosts(snapshot).maxPosts).toBe(20);
  });

  test("an approved Signal note takes priority over automatic generation", async () => {
    const snapshot = { ...capacity, signalQueued: 1 };
    expect((await automaticGenerationPreflight({ getNoteSubmissionCapacity: async () => snapshot })).allowed).toBe(false);
    expect(computeMaxPosts(snapshot).maxPosts).toBe(0);
  });

  test("a real limit pauses generation until shared admission authorizes another attempt", async () => {
    const snapshot = { ...capacity, canSubmit: false, nextAttemptAt: "2026-09-15T12:00:00Z" };
    expect(await automaticGenerationPreflight({ getNoteSubmissionCapacity: async () => snapshot }))
      .toMatchObject({ allowed: false, reason: expect.stringContaining(snapshot.nextAttemptAt) });
    expect(computeMaxPosts(snapshot).maxPosts).toBe(0);
  });

  test("an allowed cooldown probe processes one candidate despite zero estimated headroom", async () => {
    const snapshot = { ...capacity, remaining: 0, probe: true };
    const result = await automaticGenerationPreflight({ getNoteSubmissionCapacity: async () => snapshot });
    expect(result.allowed).toBe(true);
    expect(computeMaxPosts(snapshot).maxPosts).toBe(1);
  });

});

describe("submission admission RPC responses", () => {
  test("keeps unavailable capacity distinct from zero", () => {
    expect(parseSubmissionCapacity({ ...capacity, cap: null, remaining: null }).remaining).toBeNull();
    expect(parseSubmissionCapacity({ ...capacity, cap: 0, remaining: 0 }).remaining).toBe(0);
  });

  test.each([null, {}, { ...capacity, remaining: null }, { ...capacity, inFlight: -1 }, { ...capacity, used24h: "6" }, { ...capacity, reserve: 3 }, { ...capacity, canSubmit: undefined }, { ...capacity, nextAttemptAt: "invalid" }])(
    "rejects invalid capacity so it cannot bypass admission: %j", (value) => {
      expect(() => parseSubmissionCapacity(value)).toThrow();
    },
  );

  test("validates admission and its claim ID before any X request", () => {
    expect(parseSubmissionAdmission({ status: "claimed", claimId: "claim", capacity }).status).toBe("claimed");
    expect(() => parseSubmissionAdmission({ status: "claimed", capacity })).toThrow();
    expect(() => parseSubmissionAdmission({ status: "capacity_reserved", reason: "unknown", capacity })).toThrow();
    expect(() => parseSubmissionAdmission({ status: "claimed", claimId: "claim", capacity: null })).toThrow();
  });
});

describe("uncertain X submissions", () => {
  test.each([undefined, 200, 302, 408, 500, 502, 503])("retains the claim after status %s", (status) => {
    expect(isUncertainSubmissionError({ response: { status } })).toBe(true);
  });

  test.each([400, 401, 403, 404, 409, 422, 429])("releases a definitively rejected status %s", (status) => {
    expect(isUncertainSubmissionError({ response: { status } })).toBe(false);
  });
});
