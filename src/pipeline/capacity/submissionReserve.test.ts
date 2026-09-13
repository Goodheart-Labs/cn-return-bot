import { describe, expect, test } from "bun:test";
import { automaticGenerationPreflight, isUncertainSubmissionError, parseSubmissionAdmission, parseSubmissionCapacity } from "./submissionReserve";

const capacity = { cap: 10, used24h: 6, inFlight: 1, remaining: 3, reserve: 3 };

describe("automatic generation capacity preflight", () => {
  test("does not authorize paid generation without a database logger", async () => {
    expect((await automaticGenerationPreflight(null)).allowed).toBe(false);
  });

  test("a missing migration or failed capacity read closes generation instead of throwing", async () => {
    const result = await automaticGenerationPreflight({
      getNoteSubmissionCapacity: async () => { throw new Error("RPC does not exist"); },
    });
    expect(result).toMatchObject({ allowed: false, reason: expect.stringContaining("migration 093") });
  });

  test("unknown capacity closes generation", async () => {
    expect((await automaticGenerationPreflight({
      getNoteSubmissionCapacity: async () => ({ ...capacity, cap: null, remaining: null }),
    })).allowed).toBe(false);
  });

  test.each([0, 2, 3])("does not start generation with %d estimated slots remaining", async (remaining) => {
    expect((await automaticGenerationPreflight({
      getNoteSubmissionCapacity: async () => ({ ...capacity, remaining }),
    })).allowed).toBe(false);
  });

  test("allows generation above the reserve without claiming a slot", async () => {
    let reads = 0;
    expect(await automaticGenerationPreflight({
      getNoteSubmissionCapacity: async () => { reads++; return { ...capacity, remaining: 4 }; },
    })).toEqual({ allowed: true });
    expect(reads).toBe(1);
  });
});

describe("submission reserve RPC responses", () => {
  test("keeps unavailable capacity distinct from zero", () => {
    expect(parseSubmissionCapacity({ ...capacity, cap: null, remaining: null }).remaining).toBeNull();
    expect(parseSubmissionCapacity({ ...capacity, cap: 0, remaining: 0 }).remaining).toBe(0);
  });

  test.each([null, {}, { ...capacity, remaining: null }, { ...capacity, inFlight: -1 }, { ...capacity, used24h: "6" }])(
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
