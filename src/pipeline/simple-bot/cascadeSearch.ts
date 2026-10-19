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
import { OPENROUTER_NATIVE_WEB_SEARCH_TOOL, stripBrowserLineCitations } from "../tool-calling/tools";
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
/** Of the claims below that line, this share is escalated anyway. Those runs show how often the cheap step is wrong when it says no, which would otherwise stay invisible. */
export const CASCADE_AUDIT_SHARE = 0.1;

export const CASCADE_WEAK_MODEL = "meta/muse-spark-1.3-contributor";
/** The cheap step is retried on this model when the first one fails, for example when Meta blocks our access. */
export const CASCADE_WEAK_FALLBACK_MODEL = "openai/gpt-6-luna";
/** For a Common Notes claim, the stronger model is this one. For an X post it is the search model the run was configured with. */
export const CASCADE_COMMONNOTES_STRONG_MODEL = "anthropic/claude-sonnet-5.5";
const CASCADE_REASONING_EFFORT = "medium";

const SCHEMA_HINT = `{ "findings": string, "misleading_probability": number }`;

/** "audit" is an escalation of a claim the cheap step wanted to drop. It runs the same stronger search as "escalate". */
export type CascadeDecision = "note" | "no_note" | "escalate" | "audit";

export function cascadeDecisionOf(probability: number, random: () => number = Math.random): CascadeDecision {
  if (probability >= CASCADE_NOTE_AT_OR_ABOVE) return "note";
  if (probability >= CASCADE_NO_NOTE_BELOW) return "escalate";
  return random() < CASCADE_AUDIT_SHARE ? "audit" : "no_note";
}

interface WeakSearchResult {
  probability: number;
  findings: string;
  model: string;
}

/** One research call of the cheap step on one model, with the usual corrective re-asks when the JSON is bad. */
async function askWeakModel(userMessage: string, model: string, systemPrompt: string): Promise<WeakSearchResult> {
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
      const response = await llm.create({ model, tools: [OPENROUTER_NATIVE_WEB_SEARCH_TOOL], reasoning_effort: CASCADE_REASONING_EFFORT, messages } as any);
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
  trackLlmCall({ name: COST.weakSearch, ...cost, tools: [] });
  const findings = appendUrlCitations(stripBrowserLineCitations(output.findings), message?.annotations);
  return { probability: output.misleading_probability, findings, model };
}

/** The cheap step: Muse first, and GPT-6 Luna when Muse fails. */
async function runWeakSearch(userMessage: string): Promise<WeakSearchResult> {
  const log = getTweetLog();
  const systemPrompt = getBotConfig().commonnotes_pipeline ? SEARCH_SYSTEM_PROMPT_CLAIM_PROBABILITY : SEARCH_SYSTEM_PROMPT_PROBABILITY;
  log?.set(`${STEP.weakSearch}.messages.0`, { systemPrompt, userMessage });
  let result: WeakSearchResult;
  try {
    result = await askWeakModel(userMessage, CASCADE_WEAK_MODEL, systemPrompt);
  } catch (err: any) {
    log?.set(`${STEP.weakSearch}.fallback_reason`, err?.message ?? String(err));
    result = await askWeakModel(userMessage, CASCADE_WEAK_FALLBACK_MODEL, systemPrompt);
  }
  log?.set(`${STEP.weakSearch}.messages.1`, { content: { findings: result.findings, misleading_probability: result.probability }, model: result.model });
  return result;
}

/** The config of the stronger search: Sonnet 5.5 for a claim, the run's own search model for a post. */
function strongSearchConfig() {
  const config = getBotConfig();
  const base = { ...config, search_reasoning_effort: CASCADE_REASONING_EFFORT } as const;
  return config.commonnotes_pipeline ? { ...base, search_model: CASCADE_COMMONNOTES_STRONG_MODEL, web_search: "native" as const } : base;
}

export async function runCascadingSearch(userMessage: string): Promise<SearchResult> {
  const weak = await runWeakSearch(userMessage);
  const decision = cascadeDecisionOf(weak.probability);
  getTweetLog()?.set("cascade", { probability: weak.probability, answered_by: weak.model, decision });
  if (decision === "note") return { findings: weak.findings, correctionNeeded: true };
  if (decision === "no_note") return { findings: weak.findings, correctionNeeded: false };
  return withBotConfig(strongSearchConfig(), () => runSearch(userMessage));
}
