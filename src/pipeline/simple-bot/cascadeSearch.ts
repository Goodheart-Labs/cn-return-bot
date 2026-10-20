/**
 * The cascading search step.
 *
 * A cheap model researches the claim first and gives its probability that the
 * claim is misleading in any way. That probability decides what happens next:
 * at CASCADE_NOTE_AT_OR_ABOVE the writer gets the cheap model's findings at
 * once, below CASCADE_NO_NOTE_BELOW the run ends with no note, and in between a
 * stronger model repeats the research the way the regular search step does.
 * SEARCH_CASCADE_TEST in abTestsData.ts switches this step on.
 */

import { llm } from "../llm/llm";
import { CLAUDE_RESEARCH_FETCH_TOOL, OPENROUTER_NATIVE_WEB_SEARCH_TOOL, WEB_SEARCH_TOOL, stripBrowserLineCitations } from "../tool-calling/tools";
import { getBotConfig, withBotConfig } from "../ab-testing/botConfig";
import { SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY, SEARCH_SYSTEM_PROMPT_PROBABILITY } from "../prompts/simple-bot/searchAgent";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost } from "../cost-tracking/pricing";
import { trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { COST, STEP } from "../utils/noteWriterSteps";
import { extractJsonObject } from "../utils/jsonOutput";
import { parseJsonWithRetry } from "../utils/jsonLlmCall";
import { appendUrlCitations } from "./searchDispatch";
import { runSearch, type SearchResult } from "./search";

/** At or above this probability the cheap model's findings go straight to the writer. */
export const CASCADE_NOTE_AT_OR_ABOVE = 0.9;
/** Below this probability the claim needs no note and the run ends. */
export const CASCADE_NO_NOTE_BELOW = 0.3;
/** The stronger model answers with the same probability. At or above this value its findings go to the writer. */
export const CASCADE_STRONG_NOTE_AT_OR_ABOVE = 0.5;

export const CASCADE_WEAK_MODEL = "meta/muse-spark-1.3-contributor";
/** The cheap step is retried on this model when the first one fails, for example when Meta blocks our access. */
export const CASCADE_WEAK_FALLBACK_MODEL = "openai/gpt-6-luna";
/** For a Common Notes claim, the stronger model is this one. For an X post it is the search model the run was configured with. */
export const CASCADE_COMMONNOTES_STRONG_MODEL = "anthropic/claude-sonnet-5.5";
const CASCADE_REASONING_EFFORT = "medium";

const SCHEMA_HINT = `{ "findings": string, "misleading_probability": number }`;

/** "audit" is an escalation of a claim the cheap step wanted to drop, in a run on the audit arm of CASCADE_AUDIT_TEST. It runs the same stronger search as "escalate". */
export type CascadeDecision = "note" | "no_note" | "escalate" | "audit";

export function cascadeDecisionOf(probability: number, audit: boolean): CascadeDecision {
  if (probability >= CASCADE_NOTE_AT_OR_ABOVE) return "note";
  if (probability >= CASCADE_NO_NOTE_BELOW) return "escalate";
  return audit ? "audit" : "no_note";
}

export interface WeakSearchResult {
  probability: number;
  findings: string;
  model: string;
}

/** One research call on one model, with the usual corrective re-asks when the JSON is bad. The cheap and the strong step both use it, so both answer the same question with the same prompt. */
async function askResearchModel(params: { userMessage: string; model: string; systemPrompt: string; tools: any[]; costName: string }): Promise<WeakSearchResult> {
  const { userMessage, model, systemPrompt, tools, costName } = params;
  const cost = emptyTokenCost();
  let message: any;
  const output = await parseJsonWithRetry<{ findings: string; misleading_probability: number }>({
    source: `cascadeWeakSearch(${model})`,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    schemaHint: SCHEMA_HINT,
    call: async (messages) => {
      const response = await llm.create({ model, tools, reasoning_effort: CASCADE_REASONING_EFFORT, messages } as any);
      addTokenCost(cost, extractOpenRouterCost(response));
      message = response.choices?.[0]?.message;
      const raw = message?.content ?? "";
      return { toParse: extractJsonObject(raw), assistantEcho: raw };
    },
    parse: (toParse) => {
      const parsed = JSON.parse(toParse);
      const inRange = typeof parsed.misleading_probability === "number" && parsed.misleading_probability >= 0 && parsed.misleading_probability <= 1;
      if (typeof parsed.findings !== "string" || !inRange) throw new Error("search JSON missing findings or a misleading_probability between 0 and 1");
      return parsed;
    },
  });
  trackLlmCall({ name: costName, ...cost, tools: [] });
  const findings = appendUrlCitations(stripBrowserLineCitations(output.findings), message?.annotations);
  return { probability: output.misleading_probability, findings, model };
}

function askWeakModel(userMessage: string, model: string, systemPrompt: string): Promise<WeakSearchResult> {
  return askResearchModel({ userMessage, model, systemPrompt, tools: [OPENROUTER_NATIVE_WEB_SEARCH_TOOL], costName: COST.weakSearch });
}

function researchPrompt(): string {
  return getBotConfig().commonnotes_pipeline ? SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY : SEARCH_SYSTEM_PROMPT_PROBABILITY;
}

/** The cheap step: Muse first, and GPT-6 Luna when Muse fails. The log key says where the messages are kept, so that a second round does not overwrite the first. */
export async function runQuickSearch(userMessage: string, logKey: string = STEP.weakSearch): Promise<WeakSearchResult> {
  const log = getTweetLog();
  const systemPrompt = researchPrompt();
  log?.set(`${logKey}.messages.0`, { systemPrompt, userMessage });
  let result: WeakSearchResult;
  try {
    result = await askWeakModel(userMessage, CASCADE_WEAK_MODEL, systemPrompt);
  } catch (err: any) {
    log?.set(`${logKey}.fallback_reason`, err?.message ?? String(err));
    result = await askWeakModel(userMessage, CASCADE_WEAK_FALLBACK_MODEL, systemPrompt);
  }
  log?.set(`${logKey}.messages.1`, { content: { findings: result.findings, misleading_probability: result.probability }, model: result.model });
  return result;
}

/** The config of the stronger search: Sonnet 5.5 for a claim, the run's own search model for a post. */
function strongSearchConfig() {
  const config = getBotConfig();
  const base = { ...config, search_reasoning_effort: CASCADE_REASONING_EFFORT } as const;
  return config.commonnotes_pipeline ? { ...base, search_model: CASCADE_COMMONNOTES_STRONG_MODEL, web_search: "native" as const } : base;
}

/** The stronger search of the cascade. It asks the same question as the cheap step, with the same prompt and the same probability answer. A claim note is written from findings at CASCADE_STRONG_NOTE_AT_OR_ABOVE or more.
 *  Only the Claude search models run this way. Another model on an X post still uses the regular search step with its own prompt, because each provider there has its own output format. */
export async function runStrongSearch(userMessage: string): Promise<SearchResult> {
  const config = strongSearchConfig();
  if (config.web_search !== "native") return withBotConfig(config, () => runSearch(userMessage));
  const log = getTweetLog();
  const systemPrompt = researchPrompt();
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage });
  const model = config.search_model ?? config.model;
  const answer = await askResearchModel({ userMessage, model, systemPrompt, tools: [WEB_SEARCH_TOOL, CLAUDE_RESEARCH_FETCH_TOOL], costName: COST.search });
  log?.set(`${STEP.search}.messages.1`, { content: { findings: answer.findings, misleading_probability: answer.probability }, model });
  return { findings: answer.findings, correctionNeeded: answer.probability >= CASCADE_STRONG_NOTE_AT_OR_ABOVE };
}

export async function runCascadingSearch(userMessage: string): Promise<SearchResult> {
  const weak = await runQuickSearch(userMessage);
  const decision = cascadeDecisionOf(weak.probability, !!getBotConfig().cascade_audit);
  getTweetLog()?.set("cascade", { probability: weak.probability, answered_by: weak.model, decision });
  if (decision === "note") return { findings: weak.findings, correctionNeeded: true, researchedBy: "quick" };
  if (decision === "no_note") return { findings: weak.findings, correctionNeeded: false, researchedBy: "quick" };
  return { ...(await runStrongSearch(userMessage)), researchedBy: "full" };
}
