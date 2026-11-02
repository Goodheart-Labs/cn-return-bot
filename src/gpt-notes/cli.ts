/* Runs the GPT note writer on one post or one X tweet as a dry run (GOO-682).
 * It reads its input from prod and writes nothing there. Everything the run
 * produced goes into a run folder: the drafts or the X answer, one line per
 * model request, and a summary with the cost.
 *
 * Usage:
 *   bun run gpt-notes post <item id or post URL> [options]
 *   bun run gpt-notes tweet <pipeline_runs id> [options]
 *
 * A tweet is one the X run gave to the Claude note writer: GPT gets the input
 * and the A/B picks stored on that row, exactly what Claude got.
 *
 * Options:
 *   --effort low|medium|high|xhigh|max   reasoning effort, high by default
 *   --tier flex|default                  OpenAI's service tier, flex by default; "default" is the standard tier
 *   --provider openrouter|openai         where requests go, OpenRouter by default
 *   --pick <test>=<variant>              fixes a post's A/B pick, for example --pick claude_cn_taste=with_thoughts
 *   --out <folder>                       the run folder, by default under ~/.local/share/gpt-notes/runs */

import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { parseArgs } from "util";
import { db, readItem } from "../claude-notes/store";
import { isWholePageChecked } from "../everything-core/wholePageChecked";
import { openPassageRequests } from "../everything/passageRequests";
import { pickVariantName } from "../pipeline/ab-testing/abTests";
import { CLAUDE_CN_TASTE_TEST } from "../pipeline/ab-testing/abTestsData";
import { runJob, type HarnessSettings, type ReasoningEffort, type RunRecord } from "./harness";
import type { Provider } from "./model";
import type { ServiceTier } from "./pricing";
import type { Job } from "./prompts";

const RUNS_DIR = path.join(homedir(), ".local/share/gpt-notes/runs");

// The local copy of OPENROUTER_API_KEY is dead. Local runs use the testing
// key instead, like the repo's other local scripts.
if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const TIERS: ServiceTier[] = ["flex", "default"];
const PROVIDERS: Provider[] = ["openai", "openrouter"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    effort: { type: "string", default: "high" },
    tier: { type: "string", default: "flex" },
    provider: { type: "string", default: "openrouter" },
    pick: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
  },
});

function settingsFromArgs(): HarnessSettings {
  const effort = values.effort as ReasoningEffort;
  const tier = values.tier as ServiceTier;
  const provider = values.provider as Provider;
  if (!EFFORTS.includes(effort)) throw new Error(`--effort must be one of ${EFFORTS.join(", ")}`);
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of ${TIERS.join(", ")}`);
  if (!PROVIDERS.includes(provider)) throw new Error(`--provider must be one of ${PROVIDERS.join(", ")}`);
  return { effort, tier, provider };
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
  return { kind: "tweet", runId, input: data.input as string, picks: data.ab_test_picks as Record<string, string> };
}

function runFolderName(job: Job): string {
  const subject = job.kind === "post" ? job.item.url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60) : `x-${job.runId}`;
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${subject}`;
}

function summarize(record: RunRecord, minutes: number) {
  const sum = (pick: (r: RunRecord["requests"][number]) => number) => record.requests.reduce((total, r) => total + pick(r), 0);
  const inputTokens = sum((r) => r.inputTokens);
  return {
    costUsd: Number(sum((r) => r.costUsd).toFixed(4)),
    minutes,
    requests: record.requests.length,
    subagents: new Set(record.requests.map((r) => r.agent).filter((agent) => agent.startsWith("subagent"))).size,
    failedRequests: record.failedRequests,
    webSearches: sum((r) => r.webSearches),
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
  if ((command !== "post" && command !== "tweet") || !target) throw new Error("Usage: bun run gpt-notes post <item id or URL> | tweet <pipeline_runs id>. See src/gpt-notes/cli.ts");
  const settings = settingsFromArgs();
  const job = command === "post" ? await postJob(target) : await tweetJob(target);
  const runDir = values.out ?? path.join(RUNS_DIR, runFolderName(job));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "job.json"), JSON.stringify({ settings, picks: job.picks, ...(job.kind === "post" ? { itemId: job.item.id, url: job.item.url, asked: job.asked } : { runId: job.runId }) }, null, 2));
  console.log(`Running GPT on ${job.kind === "post" ? job.item.url : `tweet run ${job.runId}`} at ${settings.effort} effort on the ${settings.tier} tier through ${settings.provider}. Run folder: ${runDir}`);
  const startedAt = Date.now();
  const record = await runJob(job, settings);
  const summary = summarize(record, Math.round((Date.now() - startedAt) / 60_000));
  writeFileSync(path.join(runDir, "drafts.json"), JSON.stringify(record.drafts, null, 2));
  if (job.kind === "tweet") writeFileSync(path.join(runDir, "x-answer.json"), JSON.stringify(record.xAnswer, null, 2));
  writeFileSync(path.join(runDir, "requests.jsonl"), record.requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (job.kind === "tweet" && !record.xAnswer) throw new Error(`The agent stopped without answering the tweet. See ${runDir}`);
}

await main();
