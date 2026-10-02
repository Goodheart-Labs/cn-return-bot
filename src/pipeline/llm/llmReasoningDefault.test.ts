import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import OpenAI from "openai";
import { llm } from "./llm";

// A local server in place of OpenRouter. It answers with the reasoning effort the
// request carried, so each test can see what llm.create actually sent.
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { reasoning_effort } = await request.json() as { reasoning_effort?: string };
    return Response.json({ choices: [{ message: { content: reasoning_effort ?? "none" } }] });
  },
});

const originalApiKey = process.env.OPENROUTER_API_KEY;
let fetchSpy: ReturnType<typeof spyOn>;
const originalFetchWithTimeout = (OpenAI.prototype as any).fetchWithTimeout;
beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "local-test-only";
  fetchSpy = spyOn(OpenAI.prototype as any, "fetchWithTimeout").mockImplementation(function(this: OpenAI, url: unknown, ...args: unknown[]) {
    const target = new URL(String(url));
    if (target.origin === "https://openrouter.ai") {
      target.protocol = "http:";
      target.host = `localhost:${server.port}`;
    }
    return originalFetchWithTimeout.call(this, target.toString(), ...args);
  });
});
afterAll(() => {
  fetchSpy.mockRestore();
  server.stop(true);
  process.env.OPENROUTER_API_KEY = originalApiKey;
});

async function sentEffort(params: Record<string, unknown>): Promise<string> {
  const response = await llm.create({ messages: [{ role: "user", content: "hi" }], ...params } as any);
  return response.choices[0]?.message.content ?? "";
}

describe("default reasoning effort", () => {
  test("a GPT-6 Luna call without its own effort reasons at medium", async () => {
    expect(await sentEffort({ model: "openai/gpt-6-luna" })).toBe("medium");
  });

  test("a call that sets its own effort keeps it", async () => {
    expect(await sentEffort({ model: "openai/gpt-6-luna", reasoning_effort: "high" })).toBe("high");
  });

  test("a model without a default gets no effort", async () => {
    expect(await sentEffort({ model: "google/gemini-3-flash-preview" })).toBe("none");
  });
});
