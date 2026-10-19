/**
 * Runs the two production code paths that now give Claude native web fetch,
 * with real paid calls, and prints what they sent and got back:
 *  1. The X bot's search step (`dispatchSearch` with web_search "native"), on
 *     the Opus 5 arm and on the Signal bot's Sonnet 5.5.
 *  2. Ask Opus (`answerPassageQuestion`), with a fake database.
 * Each question can only be answered from the body of a paper, not from a
 * search excerpt. A jump in prompt tokens shows that a page was read.
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_10_19_claude_native_fetch/productionPaths.ts [xbot|ask]
 * With NO_FETCH=1 the fetch tool is removed from every request, which gives
 * the search-only baseline the code had before.
 */
import "dotenv/config";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const ONLY = process.argv[2];

const { createAnthropicMessage } = await import("../../pipeline/llm/llm");
const { DEFAULT_CONFIG, withBotConfig } = await import("../../pipeline/ab-testing/botConfig");
const { dispatchSearch } = await import("../../pipeline/simple-bot/searchDispatch");
const { answerPassageQuestion } = await import("../../service/intake/passageQuestions");

// `llm` is a Proxy, so its methods cannot be replaced. The OpenAI SDK sends
// every request through the global fetch, so we log the replies there.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const started = Date.now();
  if (process.env.NO_FETCH && init?.body) {
    const sent = JSON.parse(init.body);
    sent.tools = sent.tools?.filter((tool: any) => tool.type !== "web_fetch_20250910");
    init = { ...init, body: JSON.stringify(sent) };
  }
  const response = await originalFetch(input, init);
  const url = String(input?.url ?? input);
  if (url.endsWith("/messages")) {
    const body: any = await response.clone().json();
    const sent = JSON.parse(init?.body ?? "{}");
    console.log(`  request: model=${sent.model} tools=${JSON.stringify(sent.tools?.map((tool: any) => tool.type ?? tool.name))}`);
    console.log(`  reply after ${((Date.now() - started) / 1000).toFixed(1)}s: provider=${body.provider} usage=${JSON.stringify({
      input: body.usage?.input_tokens, output: body.usage?.output_tokens, cost: body.usage?.cost, tools: body.usage?.server_tool_use,
    })}`);
    for (const block of body.content ?? []) {
      const detail = block.type === "text" ? block.text : block.type === "server_tool_use" || block.type === "tool_use" ? JSON.stringify(block.input) : "";
      console.log(`    [${block.type}] ${String(detail).replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  if (url.includes("/chat/completions")) {
    const body: any = await response.clone().json();
    const sent = JSON.parse(init?.body ?? "{}");
    const message = body.choices?.[0]?.message ?? {};
    console.log(`  request: model=${sent.model} tools=${JSON.stringify(sent.tools?.map((tool: any) => tool.type))}`);
    console.log(`  reply after ${((Date.now() - started) / 1000).toFixed(1)}s: provider=${body.provider} usage=${JSON.stringify({
      prompt: body.usage?.prompt_tokens, completion: body.usage?.completion_tokens, cost: body.usage?.cost, tools: body.usage?.server_tool_use_details,
    })}`);
    console.log(`  reasoning: ${String(message.reasoning ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
    console.log(`  content: ${String(message.content ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
    console.log(`  message fields: ${Object.keys(message).join(", ")}; reasoning detail types: ${JSON.stringify((message.reasoning_details ?? []).map((d: any) => d.type))}`);
  }
  return response;
}) as typeof fetch;

const TWEET = process.env.TWEET ?? `Post by @mlhistory: "Fun fact: the original Transformer paper trained its big model for only 12 hours on 8 P100 GPUs. Modern labs could learn a thing or two." Check this against the paper's own training section.`;

async function xBotSearch(label: string, searchModel: string) {
  console.log(`\n=== X bot search step, ${label}`);
  const result = await withBotConfig(
    { ...DEFAULT_CONFIG, botId: "simple-bot", web_search: "native", search_model: searchModel },
    () => dispatchSearch(TWEET, "search"),
  );
  console.log(`  correction_needed=${result.correctionNeeded} cost=${result.costEntry.cost}`);
  console.log(`  findings: ${result.findings.slice(0, 1500)}`);
}

async function askOpus() {
  console.log("\n=== Ask Opus");
  const writes: Record<string, unknown>[] = [];
  const db = { from(_table: string) {
    let update = false;
    const query: any = {
      select: () => query,
      update(values: Record<string, unknown>) { update = true; writes.push(values); return query; },
      eq: () => query, lt: () => query, order: () => query, limit: () => query,
      single: () => Promise.resolve({ data: { title: "Why transformers won", url: "https://example.com/transformers", full_text: "The 2017 paper Attention Is All You Need (https://arxiv.org/abs/1706.03762) showed that attention alone could beat recurrent networks. Its big model needed only 12 hours of training on 8 GPUs." }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ data: update ? null : [], error: null })); },
    };
    return query;
  } };
  await answerPassageQuestion({
    id: "probe", item_id: "probe", author_id: "probe", passage: "Its big model needed only 12 hours of training on 8 GPUs.",
    question: "Is that right? Check the paper's training section itself, not a summary.",
    status: "answering", answer: null, draft: null, error: null, model: null, cost_usd: 0, created_at: new Date().toISOString(), started_at: null, answered_at: null,
    draft_outcome: null, draft_posted_id: null,
  } as any, { db: db as never, complete: createAnthropicMessage, budgetExhausted: async () => false });
  console.log(`  final write: ${JSON.stringify(writes.at(-1)).slice(0, 2000)}`);
  console.log(`  draft: ${JSON.stringify(writes.find((w) => w.draft)?.draft ?? null)}`);
}

if (!ONLY || ONLY === "xbot") {
  await xBotSearch("Opus 5 arm", "anthropic/claude-opus-5");
  await xBotSearch("Signal bot's Sonnet 5.5", "anthropic/claude-sonnet-5.5");
}
if (!ONLY || ONLY === "ask") await askOpus();
