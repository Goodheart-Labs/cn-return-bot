import { expect, mock, test } from "bun:test";
import type OpenAI from "openai";
import { answerPassageQuestion } from "./passageQuestions";
import type { PassageQuestion } from "../../everything-core/passageHighlights";

const question: PassageQuestion = {
  id: "q1", item_id: "article1", author_id: "reader1", passage: "The grid will double in size.", question: "Help me understand this.",
  status: "answering", answer: null, draft: null, error: null, model: null, cost_usd: 0, created_at: "2026-09-29T10:00:00Z", started_at: "2026-09-29T10:00:01Z", answered_at: null,
};

function setup(calls: { name: string; args: unknown }[] = [], options: { budget?: boolean; failure?: boolean; answer?: string; searches?: number[] } = {}) {
  const writes: { table: string; values: Record<string, unknown> }[] = [];
  const reads: { table: string; field: string; value: unknown }[] = [];
  const db = { from(table: string) {
    let update = false;
    const query = {
      select: () => query,
      update(values: Record<string, unknown>) { update = true; writes.push({ table, values }); return query; },
      insert(values: Record<string, unknown>) { writes.push({ table, values }); return query; },
      eq(field: string, value: unknown) { reads.push({ table, field, value }); return query; },
      lt: () => query, order: () => query, limit: () => query,
      single: () => Promise.resolve({ data: { title: "Grid article", url: "https://example.com/grid", full_text: "body ".repeat(20000) }, error: null }),
      then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ data: update ? null : [{ question: "Earlier question", answer: "Earlier answer" }], error: null })); },
    };
    return query;
  } };
  let turn = 0;
  const complete = mock(async (params: OpenAI.ChatCompletionCreateParamsNonStreaming) => {
    const searches = options.searches?.[turn++] ?? 0;
    if (options.failure && params.messages.length > 2) throw new Error("upstream failed");
    const first = params.messages.length === 2;
    return {
      id: "reply1", created: 0, model: "anthropic/claude-opus-5.5", object: "chat.completion",
      choices: [{ index: 0, logprobs: null, finish_reason: "stop", message: first && calls.length
        ? { role: "assistant", refusal: null, content: null, tool_calls: calls.map((call, i) => ({ id: `t${i}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) }
        : { role: "assistant", refusal: null, content: options.answer ?? "Here is a short answer." } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.002, server_tool_use_details: { web_search_requests: searches } },
    } as OpenAI.ChatCompletion;
  });
  return { writes, reads, complete, deps: { db: db as never, complete, budgetExhausted: async () => !!options.budget } };
}

test("request_note inserts the passage and steer, but never note text", async () => {
  const { deps, writes, reads, complete } = setup([{ name: "request_note", args: { steer: "the capacity estimate" } }]);
  await answerPassageQuestion(question, deps);
  expect(writes.find((w) => w.table === "everything_note_requests")?.values).toEqual({ page_url: "https://example.com/grid", page_title: "Grid article", selection: question.passage, user_id: "reader1", steer: "the capacity estimate", passage_question_id: "q1" });
  expect(writes.some((w) => w.table === "everything_notes")).toBe(false);
  expect(writes.at(-1)?.values).toMatchObject({ status: "done", answer: "Here is a short answer." });
  expect(writes.filter((w) => "cost_usd" in w.values).at(-1)?.values.cost_usd).toBe(0.004);
  expect(reads).toContainEqual({ table: "everything_passage_questions", field: "author_id", value: "reader1" });
  const context = JSON.parse(complete.mock.calls[0]![0].messages[1]!.content as string);
  expect(context.article).toHaveLength(60000);
  expect(context.earlier).toEqual([{ question: "Earlier question", answer: "Earlier answer" }]);
});

test("plain note requests leave steer null and duplicate tool calls enqueue once", async () => {
  const { deps, writes } = setup([{ name: "request_note", args: {} }, { name: "request_note", args: {} }]);
  await answerPassageQuestion(question, deps);
  const requests = writes.filter((w) => w.table === "everything_note_requests");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.values.steer).toBeNull();
});

test("draft tools save editable drafts, never public highlights", async () => {
  for (const [call, draft] of [
    [{ name: "draft_forecast", args: { probability: 65, statement: "The grid doubles by 2035" } }, { kind: "forecast", probability: 65, statement: "The grid doubles by 2035" }],
    [{ name: "draft_key_point", args: { point: "Capacity is the bottleneck" } }, { kind: "key_point", statement: "Capacity is the bottleneck" }],
  ] as const) {
    const { deps, writes } = setup([call]);
    await answerPassageQuestion(question, deps);
    expect(writes.find((w) => w.values.draft)?.values.draft).toEqual(draft);
    expect(writes.every((w) => w.table === "everything_passage_questions")).toBe(true);
  }
});

test("invalid forecast probability fails without a draft", async () => {
  const { deps, writes } = setup([{ name: "draft_forecast", args: { probability: 100.5, statement: "Rain" } }]);
  await answerPassageQuestion(question, deps);
  expect(writes.some((w) => w.values.draft)).toBe(false);
  expect(writes.at(-1)?.values.status).toBe("error");
});

test("budget exhaustion avoids the LLM and reports the specified error", async () => {
  const { deps, writes, complete } = setup([], { budget: true });
  await answerPassageQuestion(question, deps);
  expect(complete).not.toHaveBeenCalled();
  expect(writes.at(-1)?.values).toMatchObject({ status: "error", error: "Daily budget reached", cost_usd: 0 });
});

test("a failure after a paid turn keeps its cost and draft", async () => {
  const { deps, writes } = setup([{ name: "draft_key_point", args: { point: "Capacity matters" } }], { failure: true });
  await answerPassageQuestion(question, deps);
  expect(writes.at(-1)?.values).toMatchObject({ status: "error", cost_usd: 0.002 });
  expect(writes.some((w) => w.values.draft)).toBe(true);
});

test("the agent can search the web, at most three times per question", async () => {
  const { deps, complete } = setup([{ name: "draft_forecast", args: { probability: 20, statement: "Rain in London tomorrow" } }], { searches: [2, 0] });
  await answerPassageQuestion(question, deps);
  const searchTools = complete.mock.calls.map(([params]) => (params.tools as unknown[]).filter((tool) => (tool as { type: string }).type === "openrouter:web_search"));
  expect(searchTools).toEqual([[{ type: "openrouter:web_search", parameters: { engine: "native", max_uses: 3 } }], [{ type: "openrouter:web_search", parameters: { engine: "native", max_uses: 1 } }]]);
  expect(complete.mock.calls.every(([params]) => (params.max_tokens ?? 0) <= 2000)).toBe(true);

  const spent = setup([{ name: "draft_key_point", args: { point: "Capacity matters" } }], { searches: [3] });
  await answerPassageQuestion(question, spent.deps);
  expect((spent.complete.mock.calls[1]![0].tools as { type: string }[]).some((tool) => tool.type === "openrouter:web_search")).toBe(false);
});

test("answers drop the search tool's line citations but keep markdown links", async () => {
  const { deps, writes } = setup([], { answer: "Demand rose 3%【4471†L10-L12】 in 2025, per [the IEA](https://www.iea.org/report)." });
  await answerPassageQuestion(question, deps);
  expect(writes.at(-1)?.values).toMatchObject({ status: "done", answer: "Demand rose 3% in 2025, per [the IEA](https://www.iea.org/report)." });
});

test("the prompt asks for searches and short replies, and the draft tools ask for the bare event", async () => {
  const { deps, complete } = setup();
  await answerPassageQuestion(question, deps);
  const params = complete.mock.calls[0]![0];
  const system = params.messages[0]!.content as string;
  expect(system).not.toContain("no browsing tool");
  expect(system).toContain("Search the web when the question turns on facts or recent events");
  expect(system).toContain("one or two sentences");
  const tools = Object.fromEntries((params.tools as OpenAI.ChatCompletionTool[]).filter((tool) => tool.type === "function").map((tool) => [tool.function.name, tool.function]));
  const statement = (tools.draft_forecast!.parameters!.properties as Record<string, { description: string }>).statement!.description;
  expect(statement).toContain("Only the event, worded to complete \"N% chance of …\"");
  expect(statement).toContain("No commentary");
  const point = (tools.draft_key_point!.parameters!.properties as Record<string, { description: string }>).point!.description;
  expect(point).toContain("worded to complete \"A key point in this article is …\"");
  expect(point).toContain("No commentary");
});
