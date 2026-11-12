/* Runs the agent note writer on one post or one X tweet as a dry run (GOO-682).
 * It reads its input from prod and writes nothing there. Everything the run
 * produced goes into a run folder: the drafts or the X answer, one line per
 * model request with its cost, every agent's conversation in trajectory.jsonl,
 * and a summary with the cost.
 *
 * Usage:
 *   bun run agent-notes post <item id or post URL> [options]
 *   bun run agent-notes tweet <pipeline_runs id> [options]
 *
 * A tweet is one the X run gave to the Claude note writer: the model gets the
 * input and the A/B picks stored on that row, exactly what Claude got. That
 * input lists the tweet's images only as links, and the harness never sends
 * images, so the model does not see them. The X bots describe them instead.
 *
 * Options:
 *   --model gpt-6.1-terra|sonnet-5.5     the model, GPT-6.1 Terra by default
 *   --effort low|medium|high|xhigh|max   reasoning effort, high by default
 *   --tier flex|default                  OpenAI's service tier, flex by default; "default" is the standard tier
 *   --provider openrouter|openai         where requests go, OpenRouter by default
 *   --pick <test>=<variant>              fixes a post's A/B pick, for example --pick claude_cn_taste=with_thoughts
 *   --examples <file>                    replaces the examples in the system prompt, for experiments
 *   --out <folder>                       the run folder, by default under ~/.local/share/agent-notes/runs */

import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { parseArgs } from "util";
import { readItem } from "../claude-notes/store";
import { db } from "../serviceDb";
import { isWholePageChecked } from "../everything-core/wholePageChecked";
import { openPassageRequests } from "../everything/passageRequests";
import { pickVariantName } from "../pipeline/ab-testing/abTests";
import { CLAUDE_CN_TASTE_TEST } from "../pipeline/ab-testing/abTestsData";
import { SERPER_COST_PER_SEARCH } from "../pipeline/cost-tracking/pricing";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { runJob, type HarnessSettings, type ReasoningEffort, type RunRecord } from "./harness";
import { HARNESS_MODELS, type HarnessModel, type Provider } from "./model";
import type { ServiceTier } from "./pricing";
import type { Job } from "./prompts";

const RUNS_DIR = path.join(homedir(), ".local/share/agent-notes/runs");

// The local copy of OPENROUTER_API_KEY is dead. Local runs use the testing
// key instead, like the repo's other local scripts.
if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const TIERS: ServiceTier[] = ["flex", "default"];
const PROVIDERS: Provider[] = ["openai", "openrouter"];
const MODELS = Object.keys(HARNESS_MODELS) as HarnessModel[];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string", default: "gpt-6.1-terra" },
    effort: { type: "string", default: "high" },
    tier: { type: "string", default: "flex" },
    provider: { type: "string", default: "openrouter" },
    pick: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
    examples: { type: "string" },
  },
});

function settingsFromArgs(): HarnessSettings {
  const model = values.model as HarnessModel;
  const effort = values.effort as ReasoningEffort;
  const tier = values.tier as ServiceTier;
  const provider = values.provider as Provider;
  if (!MODELS.includes(model)) throw new Error(`--model must be one of ${MODELS.join(", ")}`);
  if (!EFFORTS.includes(effort)) throw new Error(`--effort must be one of ${EFFORTS.join(", ")}`);
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of ${TIERS.join(", ")}`);
  if (!PROVIDERS.includes(provider)) throw new Error(`--provider must be one of ${PROVIDERS.join(", ")}`);
  return { model, effort, tier, provider, examplesPath: values.examples };
}

async function itemIdFor(itemIdOrUrl: string): Promise<string> {
  if (!itemIdOrUrl.startsWith("http")) return itemIdOrUrl;
  const { data, error } = await db().from("everything_items").select("id").eq("url", itemIdOrUrl).maybeSingle();
  if (error) throw new Error(JSON.stringify(error));
  if (!data) throw new Error(`No item has the address ${itemIdOrUrl}`);
  return data.id;
}

/** A post's picks are drawn like the runner on ai-box draws them, unless
 *  --pick fixes them. */
async function postJob(itemIdOrUrl: string): Promise<Job> {
  const item = await readItem(await itemIdFor(itemIdOrUrl));
  if (!item.full_text) throw new Error(`${item.url} has no stored text. The dry run reads only stored text.`);
  const requests = await openPassageRequests(item.id);
  const fixedPicks = Object.fromEntries(values.pick.map((pick) => pick.split("=")));
  const picks = { [CLAUDE_CN_TASTE_TEST.name]: pickVariantName(CLAUDE_CN_TASTE_TEST), ...fixedPicks };
  return { kind: "post", item, asked: { requests, onlyThese: requests.length > 0 && isWholePageChecked(item) }, picks };
}

async function tweetJob(runId: string): Promise<Job> {
  const { data, error } = await db().from("pipeline_runs").select("input:logs->claude->>input, ab_test_picks").eq("id", runId).single();
  if (error) throw new Error(JSON.stringify(error));
  if (!data.input) throw new Error(`Run ${runId} has no input for the Claude note writer`);
  return { kind: "tweet", input: data.input as string, picks: data.ab_test_picks as Record<string, string> };
}

/** A tweet's folder is named after its pipeline_runs id, the target. */
function runFolderName(job: Job, target: string): string {
  const subject = job.kind === "post" ? job.item.url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60) : `x-${target}`;
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${subject}`;
}

function summarize(record: RunRecord, minutes: number) {
  const sum = (pick: (r: RunRecord["requests"][number]) => number) => record.requests.reduce((total, r) => total + pick(r), 0);
  const inputTokens = sum((r) => r.inputTokens);
  const modelUsd = sum((r) => r.costUsd);
  const searchUsd = record.web.searches * SERPER_COST_PER_SEARCH;
  return {
    costUsd: Number((modelUsd + searchUsd).toFixed(4)),
    searchCostUsd: Number(searchUsd.toFixed(4)),
    minutes,
    requests: record.requests.length,
    subagents: new Set(record.requests.map((r) => r.agent).filter((agent) => agent.startsWith("subagent"))).size,
    failedRequests: record.failedRequests,
    searches: record.web.searches,
    pagesFetched: record.web.pagesFetched,
    inputTokens,
    cachedShareOfInput: inputTokens ? Number((sum((r) => r.cachedTokens) / inputTokens).toFixed(3)) : 0,
    outputTokens: sum((r) => r.outputTokens),
    tiersServed: [...new Set(record.requests.map((r) => r.tier))],
    notes: record.drafts.filter((d) => d.outcome === "note").length,
    drafts: record.drafts.length,
    skipReason: record.skipReason,
  };
}

async function main() {
  const [command, target] = positionals;
  if ((command !== "post" && command !== "tweet") || !target) throw new Error("Usage: bun run agent-notes post <item id or URL> | tweet <pipeline_runs id>. See src/agent-notes/cli.ts");
  const settings = settingsFromArgs();
  const job = command === "post" ? await postJob(target) : await tweetJob(target);
  const runDir = values.out ?? path.join(RUNS_DIR, runFolderName(job, target));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "job.json"), JSON.stringify({ settings, picks: job.picks, ...(job.kind === "post" ? { itemId: job.item.id, url: job.item.url, asked: job.asked } : { runId: target }) }, null, 2));
  console.log(`Running ${settings.model} on ${job.kind === "post" ? job.item.url : `tweet run ${target}`} at ${settings.effort} effort on the ${settings.tier} tier through ${settings.provider}. Run folder: ${runDir}`);
  const startedAt = Date.now();
  const record = await runJob(job, settings);
  const summary = summarize(record, Math.round((Date.now() - startedAt) / 60_000));
  writeFileSync(path.join(runDir, "drafts.json"), JSON.stringify(record.drafts, null, 2));
  if (job.kind === "tweet") writeFileSync(path.join(runDir, "x-answer.json"), JSON.stringify(record.xAnswer, null, 2));
  writeFileSync(path.join(runDir, "requests.jsonl"), record.requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(path.join(runDir, "trajectory.jsonl"), record.trajectory.map((step) => JSON.stringify(step)).join("\n") + "\n");
  writeFileSync(path.join(runDir, "web-tools.jsonl"), record.web.calls.map((call) => JSON.stringify(call)).join("\n") + "\n");
  writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (job.kind === "tweet" && !record.xAnswer) throw new Error(`The agent stopped without answering the tweet. See ${runDir}`);
}

// The fetch ladder may have started a headless browser, which would keep the
// process alive after the run.
try {
  await main();
} finally {
  await closeBrowser();
}
