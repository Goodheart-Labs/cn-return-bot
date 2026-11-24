import { afterEach, describe, expect, mock, test } from "bun:test";
import { backoffDelayMs, fetchWithRetries, isTransientStatus } from "./retry";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch with one that plays the given answers in order. A string is
 *  thrown as an error of that name, a number becomes a response with that
 *  status. */
function scriptFetch(answers: (number | string)[]) {
  const fake = mock(async () => {
    const answer = answers.shift();
    if (typeof answer === "string") throw Object.assign(new Error(answer), { name: answer });
    return new Response(null, { status: answer });
  });
  globalThis.fetch = fake as unknown as typeof fetch;
  return fake;
}

describe("isTransientStatus", () => {
  test("server errors, 408 and 429 are transient", () => {
    for (const status of [500, 502, 503, 504, 408, 429]) expect(isTransientStatus(status)).toBe(true);
  });
  test("other client errors and successes are not", () => {
    for (const status of [200, 204, 400, 401, 403, 404, 406, 409]) expect(isTransientStatus(status)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  test("doubles each retry and adds at most half again as jitter", () => {
    for (const [retry, base] of [[0, 1000], [1, 2000], [2, 4000]] as const) {
      const delay = backoffDelayMs(retry);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(base * 1.5);
    }
  });
});

describe("fetchWithRetries", () => {
  test("retries a read after a server error", async () => {
    const fake = scriptFetch([503, 200]);
    expect((await fetchWithRetries("https://example.test/")).status).toBe(200);
    expect(fake).toHaveBeenCalledTimes(2);
  });

  test("retries a read after a network error", async () => {
    const fake = scriptFetch(["TypeError", 200]);
    expect((await fetchWithRetries("https://example.test/")).status).toBe(200);
    expect(fake).toHaveBeenCalledTimes(2);
  });

  test("returns a permanent failure at once", async () => {
    const fake = scriptFetch([404]);
    expect((await fetchWithRetries("https://example.test/")).status).toBe(404);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  test("never retries an abort", async () => {
    const fake = scriptFetch(["AbortError"]);
    await expect(fetchWithRetries("https://example.test/")).rejects.toThrow();
    expect(fake).toHaveBeenCalledTimes(1);
  });

  test("sends a write exactly once", async () => {
    const fake = scriptFetch([503]);
    expect((await fetchWithRetries("https://example.test/", { method: "POST" })).status).toBe(503);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
