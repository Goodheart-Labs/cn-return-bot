import { describe, expect, test } from "bun:test";
import { tweetImageLinks } from "./harness";
import { addExamplesBreakpoint } from "./model";
import { requestCostUsd, type RequestUsage } from "./pricing";
import { subagentBrief } from "./prompts";

const NO_USAGE: RequestUsage = { inputTokens: 0, cachedTokens: 0, write30mTokens: 0, write12hTokens: 0, outputTokens: 0 };

describe("requestCostUsd", () => {
  test("bills each input token once, at the read, write or ordinary rate", () => {
    const usage = { ...NO_USAGE, inputTokens: 100_000, cachedTokens: 60_000, write30mTokens: 10_000, write12hTokens: 10_000, outputTokens: 4_000 };
    // 20K ordinary at $1, 60K read at $0.05, 10K at $1.25, 10K at $2.50, 4K output at $5.
    expect(requestCostUsd(usage, "default")).toBeCloseTo(0.02 + 0.003 + 0.0125 + 0.025 + 0.02, 6);
    expect(requestCostUsd(usage, "flex")).toBeCloseTo((0.02 + 0.003 + 0.0125 + 0.025 + 0.02) / 2, 6);
  });

  test("bills a request above 272K input tokens at the long-context rate as a whole", () => {
    const usage = { ...NO_USAGE, inputTokens: 300_000, outputTokens: 10_000 };
    expect(requestCostUsd(usage, "default")).toBeCloseTo(0.6 + 0.075, 6);
  });
});

describe("addExamplesBreakpoint", () => {
  test("turns the leading system message into a developer message with a breakpoint", () => {
    const body = { model: "m", input: [{ role: "system", content: "EXAMPLES" }, { role: "user", content: "task" }] };
    expect(addExamplesBreakpoint(body)).toEqual({
      model: "m",
      input: [
        { role: "developer", content: [{ type: "input_text", text: "EXAMPLES", prompt_cache_breakpoint: { mode: "explicit", ttl: "12h" } }] },
        { role: "user", content: "task" },
      ],
    });
  });

  test("leaves a request without a leading system message alone", () => {
    const body = { input: [{ role: "user", content: "task" }] };
    expect(addExamplesBreakpoint(body)).toBe(body);
  });
});

describe("tweetImageLinks", () => {
  test("reads the links after the images heading", () => {
    expect(tweetImageLinks("Tweet text\n\n## Images on the post\n\nhttps://a.jpg\nhttps://b.png")).toEqual(["https://a.jpg", "https://b.png"]);
  });

  test("finds none in a tweet without images", () => {
    expect(tweetImageLinks("Tweet text")).toEqual([]);
  });
});

describe("runJob against a fake Responses API", () => {
  type Item = { role?: string; type?: string; content?: unknown; output?: string };
  type Body = { input: Item[]; tools: { type: string; name?: string }[]; service_tier: string; prompt_cache_key: string; reasoning: unknown };
  const PASSAGE = "The moon is made of cheese.";
  const usage = { input_tokens: 1000, output_tokens: 10, total_tokens: 1010, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1000 }, output_tokens_details: { reasoning_tokens: 0 } };
  const response = (output: unknown[]) => ({ id: `resp_${Math.random()}`, object: "response", created_at: 0, status: "completed", model: "gpt-6.1-terra", output, usage, service_tier: "flex" });
  const functionCall = (callId: string, name: string, args: unknown) => ({ type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: "completed" });
  const message = (text: string) => ({ type: "message", id: `msg_${Math.random()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
  const isSubagent = (body: Body) => typeof body.input[1]?.content === "string" && (body.input[1].content as string).startsWith("Another agent");

  /** The main agent's first turn starts two subagents and saves a draft. Each
   *  subagent answers in text, and so does the main agent's second turn,
   *  which ends the run. */
  function answer(body: Body) {
    if (isSubagent(body)) return response([message("found it")]);
    if (body.input.at(-1)!.type === "function_call_output") return response([message("done")]);
    const draft = { passage: PASSAGE, claim: "c", kind: "wrong_or_misleading", outcome: "note", note: "n", reasoning: "r", sources: [] };
    return response([functionCall("s1", "subagent", { task: "one" }), functionCall("s2", "subagent", { task: "two" }), functionCall("d1", "save_draft", draft)]);
  }

  test("gives subagents the examples and their task, with the same cache settings", async () => {
    const bodies: Body[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as Body;
        bodies.push(body);
        return Response.json(answer(body));
      },
    });
    Object.assign(process.env, { OPENAI_API_KEY: "test", OPENAI_BASE_URL: `http://localhost:${server.port}/v1`, OPENAI_AGENTS_DISABLE_TRACING: "1" });
    const { runJob } = await import("./harness");
    const item = { id: "item-1", url: "https://example.com/p", title: "T", full_text: PASSAGE, published_at: "2026-11-01", project: { name: "C", slug: "c" } };
    const record = await runJob({ kind: "post", item: item as never, asked: { requests: [], onlyThese: false }, picks: {} }, { effort: "xhigh", tier: "flex", provider: "openai" });
    server.stop();

    expect(record.failedRequests).toEqual([]);
    expect(record.drafts.map((d) => d.passage)).toEqual([PASSAGE]);
    expect(record.requests.map((r) => r.agent).sort()).toEqual(["main 1", "main 1", "subagent 1", "subagent 2"]);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect([body.service_tier, body.prompt_cache_key, body.reasoning]).toEqual(["flex", "cn-notes-post", { effort: "xhigh" }]);
      expect(body.input[0]).toMatchObject({ role: "developer", content: [{ prompt_cache_breakpoint: { mode: "explicit", ttl: "12h" } }] });
    }
    const subagentBodies = bodies.filter(isSubagent);
    expect(subagentBodies.map((b) => b.input[1]!.content).sort()).toEqual([subagentBrief("one"), subagentBrief("two")]);
    for (const body of subagentBodies) {
      expect(body.input).toHaveLength(2);
      expect(body.tools.map((t) => t.name)).toEqual(["search", "open_page", "find_in_page"]);
    }
    const mainBodies = bodies.filter((b) => !isSubagent(b));
    expect(mainBodies[1]!.tools).toEqual(mainBodies[0]!.tools);
    expect(mainBodies[1]!.input.slice(0, mainBodies[0]!.input.length)).toEqual(mainBodies[0]!.input);
  });
});

describe("a refused flex request", () => {
  test("is retried on the standard tier", async () => {
    const tiers: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const { service_tier } = (await request.json()) as { service_tier: string };
        tiers.push(service_tier);
        const base = { id: "resp", object: "response", created_at: 0, model: "gpt-6.1-terra", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 }, service_tier };
        if (tiers.length === 1) return Response.json({ ...base, status: "failed", output: [], error: { code: "server_error", message: "Flex processing is temporarily unavailable." } });
        return Response.json({ ...base, status: "completed", output: [{ type: "message", id: "msg", role: "assistant", status: "completed", content: [{ type: "output_text", text: "done", annotations: [] }] }] });
      },
    });
    Object.assign(process.env, { OPENAI_API_KEY: "test", OPENAI_BASE_URL: `http://localhost:${server.port}/v1`, OPENAI_AGENTS_DISABLE_TRACING: "1" });
    const { runJob } = await import("./harness");
    const item = { id: "item-1", url: "https://example.com/p", title: "T", full_text: "Text.", published_at: "2026-11-01", project: { name: "C", slug: "c" } };
    const record = await runJob({ kind: "post", item: item as never, asked: { requests: [], onlyThese: false }, picks: {} }, { effort: "low", tier: "flex", provider: "openai" });
    server.stop();
    expect(tiers).toEqual(["flex", "default"]);
    expect(record.requests.map((r) => r.tier)).toEqual(["default"]);
  });
});
