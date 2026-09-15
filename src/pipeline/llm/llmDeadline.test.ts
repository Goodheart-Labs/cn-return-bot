import { afterAll, describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { AttemptDeadlineError, isRetryableError, withDeadline } from "./llm";

// A server that behaves like OpenRouter with a hanging provider: it answers 200
// with headers at once and then trickles whitespace without ever finishing the
// body. This is the shape the SDK's own timeout cannot catch.
const TRICKLE_INTERVAL_MS = 50;
const server = Bun.serve({
  port: 0,
  fetch() {
    let timer: ReturnType<typeof setInterval>;
    const body = new ReadableStream({
      start(controller) {
        timer = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), TRICKLE_INTERVAL_MS);
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  },
});
afterAll(() => server.stop(true));

const client = new OpenAI({ baseURL: `http://localhost:${server.port}/v1`, apiKey: "test", maxRetries: 0 });

describe("withDeadline", () => {
  test("cuts off a call whose headers arrived but whose body never ends", async () => {
    const deadlineMs = 300;
    const startedAt = Date.now();
    const call = withDeadline(
      deadlineMs,
      () => new AttemptDeadlineError("test/model", deadlineMs),
      (signal) => client.chat.completions.create({ model: "test/model", messages: [{ role: "user", content: "hi" }] }, { signal }),
    );
    await expect(call).rejects.toBeInstanceOf(AttemptDeadlineError);
    expect(Date.now() - startedAt).toBeLessThan(deadlineMs * 5);
  });

  test("passes a result through when the call finishes in time", async () => {
    expect(await withDeadline(1000, () => new Error("late"), async () => "done")).toBe("done");
  });

  test("passes the call's own error through when it fails in time", async () => {
    const call = withDeadline(1000, () => new Error("late"), async () => {
      throw new Error("own failure");
    });
    await expect(call).rejects.toThrow("own failure");
  });
});

test("a missed deadline is worth another attempt", () => {
  expect(isRetryableError(new AttemptDeadlineError("test/model", 1000))).toBe(true);
});
