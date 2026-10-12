import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import OpenAI from "openai";
import { AttemptDeadlineError, getLlmAbortSignal, isRetryableError, llm, withDeadline, withLlmAbortSignal } from "./llm";

// A server that behaves like OpenRouter with a hanging provider: it answers 200
// with headers at once and then trickles whitespace without ever finishing the
// body. This is the shape the SDK's own timeout cannot catch.
const TRICKLE_INTERVAL_MS = 50;
const requests = new Map<string, number>();
const bodyCancellations = new Map<string, number>();
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { model } = await request.json() as { model: string };
    requests.set(model, (requests.get(model) ?? 0) + 1);
    if (model === "cost/empty-once") {
      const first = requests.get(model) === 1;
      return Response.json({
        choices: [{ message: { content: first ? "" : "done" } }],
        usage: { prompt_tokens: 100, completion_tokens: first ? 50 : 10, cost: first ? 0.01 : 0.02 },
      });
    }
    if (model === "scope/empty") {
      return Response.json({ choices: [{ message: { content: "" } }] });
    }
    if (model === "scope/retryable") {
      return Response.json({ error: { message: "try later" } }, { status: 503, headers: { "retry-after": "30" } });
    }
    if (model === "scope/healthy") {
      await Bun.sleep(150);
      return Response.json({ choices: [{ message: { content: "done" } }] });
    }
    let timer: ReturnType<typeof setInterval>;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(" "));
        timer = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), TRICKLE_INTERVAL_MS);
      },
      cancel() {
        clearInterval(timer);
        bodyCancellations.set(model, (bodyCancellations.get(model) ?? 0) + 1);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  },
});

const originalFetchWithTimeout = (OpenAI.prototype as any).fetchWithTimeout;
const originalApiKey = process.env.OPENROUTER_API_KEY;
let fetchSpy: ReturnType<typeof spyOn>;
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "local-test-only";
  // Keep the real SDK and fetch/body handling. Redirect the singleton client's
  // OpenRouter requests to this local server so no test can make a paid call.
  fetchSpy = spyOn(OpenAI.prototype as any, "fetchWithTimeout").mockImplementation(function(this: OpenAI, url: unknown, ...args: unknown[]) {
    const target = new URL(String(url));
    if (target.origin === "https://openrouter.ai") {
      target.protocol = "http:";
      target.host = `localhost:${server.port}`;
    }
    if (target.hostname !== "localhost") throw new Error("Nonlocal request in cancellation test");
    return originalFetchWithTimeout.call(this, target.toString(), ...args);
  });
});
afterAll(() => {
  fetchSpy.mockRestore();
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
  server.stop(true);
});

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

  test("bounds a call that ignores cancellation and observes its late rejection", async () => {
    let rejectCall!: (error: Error) => void;
    const reason = new Error("deadline exhausted");
    const call = withDeadline(25, () => reason, () =>
      new Promise<never>((_resolve, reject) => { rejectCall = reject; }),
    );
    await expect(call).rejects.toBe(reason);
    rejectCall(new Error("late rejection"));
    await Bun.sleep(0);
  });
});

describe("scoped LLM cancellation", () => {
  const create = (model: string) => llm.create({ model, messages: [{ role: "user", content: "hi" }] });

  test("aborts a stalled response body without retrying or cancelling another scope", async () => {
    const stopped = new AbortController();
    const healthy = new AbortController();
    const reason = new Error("prefilter budget exhausted");
    const timer = setTimeout(() => stopped.abort(reason), 75);
    const outcomes = await Promise.allSettled([
      withLlmAbortSignal(stopped.signal, () => create("scope/stall")),
      withLlmAbortSignal(healthy.signal, () => create("scope/healthy")),
    ]);
    clearTimeout(timer);
    expect(outcomes[0]).toEqual({ status: "rejected", reason });
    expect(outcomes[1].status).toBe("fulfilled");
    expect(requests.get("scope/stall")).toBe(1);
    expect(bodyCancellations.get("scope/stall")).toBe(1);
    expect(requests.get("scope/healthy")).toBe(1);
    expect(getLlmAbortSignal()).toBeUndefined();
  });

  for (const model of ["scope/empty", "scope/retryable"]) {
    test(`cancels backoff for ${model} without a new attempt`, async () => {
      const controller = new AbortController();
      const reason = new Error("prefilter budget exhausted");
      const startedAt = Date.now();
      const timer = setTimeout(() => controller.abort(reason), 75);
      try {
        await expect(withLlmAbortSignal(controller.signal, () => create(model))).rejects.toBe(reason);
        expect(Date.now() - startedAt).toBeLessThan(500);
        // Cross our first retry's 1s boundary. In particular a server's long
        // Retry-After must not put a scoped call into the SDK's own retry loop.
        await Bun.sleep(1050);
        expect(requests.get(model)).toBe(1);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  test("does not start a call in an already-cancelled scope", async () => {
    const controller = new AbortController();
    const reason = new Error("already cancelled");
    controller.abort(reason);
    await expect(withLlmAbortSignal(controller.signal, () => create("scope/not-started"))).rejects.toBe(reason);
    expect(requests.has("scope/not-started")).toBe(false);
  });

  test("nested scopes retain the caller's cancellation", async () => {
    const parent = new AbortController();
    const child = new AbortController();
    const reason = new Error("parent exhausted");
    await withLlmAbortSignal(parent.signal, async () => {
      await withLlmAbortSignal(child.signal, async () => {
        parent.abort(reason);
        await expect(create("scope/nested-not-started")).rejects.toBe(reason);
      });
    });
    expect(requests.has("scope/nested-not-started")).toBe(false);
    expect(getLlmAbortSignal()).toBeUndefined();
  });
});

test("a missed deadline is worth another attempt", () => {
  expect(isRetryableError(new AttemptDeadlineError("test/model", 1000))).toBe(true);
});

describe("empty-reply retries", () => {
  test("the kept reply carries the usage of the empty attempt that was billed and discarded", async () => {
    const result: any = await llm.create({ model: "cost/empty-once", messages: [{ role: "user", content: "hi" }] });
    expect(result.choices[0].message.content).toBe("done");
    expect(result.usage.cost).toBeCloseTo(0.03, 10);
    expect(result.usage.prompt_tokens).toBe(200);
    expect(result.usage.completion_tokens).toBe(60);
  });
});
