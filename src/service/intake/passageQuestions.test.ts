import { expect, mock, test } from "bun:test";
import type OpenAI from "openai";
import { answerPassageQuestion } from "./passageQuestions";
import type { PassageQuestion } from "../../everything-core/passageHighlights";

const question: PassageQuestion = {
  id: "q1", item_id: "article1", author_id: "reader1", passage: "The grid will double in size.", question: "Help me understand this.",
  status: "answering", answer: null, draft: null, error: null, model: null, cost_usd: 0, created_at: "2026-09-29T10:00:00Z", started_at: "2026-09-29T10:00:01Z", answered_at: null,
};

function setup(calls: { name: string; args: unknown }[] = [], options: { budget?: boolean; failure?: boolean } = {}) {
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
  const complete = mock(async (params: OpenAI.ChatCompletionCreateParamsNonStreaming) => {
    if (options.failure && params.messages.length > 2) throw new Error("upstream failed");
    const first = params.messages.length === 2;
    return {
      id: "reply1", created: 0, model: "anthropic/claude-opus-5.5", object: "chat.completion",
      choices: [{ index: 0, logprobs: null, finish_reason: "stop", message: first && calls.length
        ? { role: "assistant", refusal: null, content: null, tool_calls: calls.map((call, i) => ({ id: `t${i}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) }
        : { role: "assistant", refusal: null, content: "Here is a short answer." } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.002 },
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
