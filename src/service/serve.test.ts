import { afterAll, describe, expect, test } from "bun:test";
import { CHECK_CLAIM_PATH, HEALTH_PATH, SERVICE_AUTH_HEADER, type HealthResponse } from "./contract";
import { startService } from "./serve";

/* These tests cover the HTTP shell: the secret, the routing, and above all the
 * keepalive stream, which is the part most likely to regress. The handler is a
 * stub, so no model runs and nothing costs money. The keepalive interval is
 * shrunk so a call that crosses it still finishes in milliseconds. */

process.env.SERVICE_AUTH_SECRET = "test-secret";

const TEST_KEEPALIVE_MS = 20;
const CROSSES_KEEPALIVE_MS = 90;

const server = startService<{ priority: "reader" | "x" | "feed"; delayMs: number }, { echoed: number }>({
  name: "claim-check",
  port: 0,
  concurrency: 2,
  reservedForReader: 1,
  keepaliveIntervalMs: TEST_KEEPALIVE_MS,
  route: {
    path: CHECK_CLAIM_PATH,
    priorityOf: (body) => body.priority,
    handle: async (body) => {
      await Bun.sleep(body.delayMs);
      if (body.delayMs < 0) throw new Error("negative delay");
      return { echoed: body.delayMs };
    },
  },
});

const base = `http://localhost:${server.port}`;
const auth = { [SERVICE_AUTH_HEADER]: "test-secret", "content-type": "application/json" };

function callWith(body: unknown) {
  return fetch(`${base}${CHECK_CLAIM_PATH}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
}

afterAll(() => server.stop(true));

describe("startService", () => {
  test("refuses a missing or wrong secret", async () => {
    expect((await fetch(`${base}${HEALTH_PATH}`)).status).toBe(401);
    expect((await fetch(`${base}${HEALTH_PATH}`, { headers: { [SERVICE_AUTH_HEADER]: "wrong" } })).status).toBe(401);
  });

  test("answers health with the queue numbers", async () => {
    const health = (await (await fetch(`${base}${HEALTH_PATH}`, { headers: auth })).json()) as HealthResponse;
    expect(health.service).toBe("claim-check");
    expect(health.concurrency).toBe(2);
    expect(health.oldestWaitSeconds).toBeNull();
    expect(health.oldestInFlightSeconds).toBeNull();
  });

  test("refuses unknown paths and wrong methods", async () => {
    expect((await fetch(`${base}/nope`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${base}${CHECK_CLAIM_PATH}`, { headers: auth })).status).toBe(405);
    expect((await fetch(`${base}${CHECK_CLAIM_PATH}`, { method: "POST", headers: auth, body: "{" })).status).toBe(400);
  });

  test("a quick call answers with plain JSON", async () => {
    const answer = JSON.parse(await (await callWith({ priority: "reader", delayMs: 1 })).text());
    expect(answer).toEqual({ echoed: 1 });
  });

  test("a slow call crosses the keepalive and the answer still parses", async () => {
    const text = await (await callWith({ priority: "reader", delayMs: CROSSES_KEEPALIVE_MS })).text();
    // The newlines sent while the work ran sit in front of the JSON. That they
    // are there proves the keepalive fired, and that JSON.parse still works
    // proves a caller never needs to care.
    expect(text.startsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ echoed: CROSSES_KEEPALIVE_MS });
  });

  test("a handler failure becomes an error answer on the stream", async () => {
    const answer = JSON.parse(await (await callWith({ priority: "feed", delayMs: -1 })).text());
    expect(answer).toEqual({ error: "negative delay" });
  });
});
