/** Cheap screening before full research. A timeout passes the post to the bot. */
import { withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import {
  PREFILTER_JUDGE_SYSTEM_PROMPT,
  PREFILTER_JUDGE_RESPONSE_FORMAT,
  buildPrefilterJudgeUserMessage,
} from "../prompts/prefilter/noteNeededJudge";
import { runQueryWriter } from "./queryWriter";
import { runSatireDetector } from "./satireDetector";
import { runSearchAnalyzer } from "./searchAnalyzer";
import { fetchSearchResults, formatSearchResults, type SearchResult } from "../tool-calling/tools";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { createTweetLog, withTweetLog, getTweetLog, type TweetLogMap } from "../utils/tweetLog";
import { withCostTracker, getCostTracker, trackLlmCall } from "../cost-tracking/costTracker";
import { STEP, COST } from "../utils/noteWriterSteps";
import { withDeadline, withLlmAbortSignal } from "../llm/llm";
import { addWarning } from "../utils/warnings";

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const MAX_RESULTS_PER_QUERY = 6;
const QUERY_WRITER_MAX_ATTEMPTS = 3;
// Total budget, including searches and retries.
const PREFILTER_DEADLINE_MS = 90_000;

class PrefilterDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`note-needed prefilter exceeded ${deadlineMs / 1000}s`);
    this.name = "PrefilterDeadlineError";
  }
}

const PREFILTER_CONFIG: BotConfig = {
  botId: "note-needed-prefilter",
  model: DEEPSEEK,
  search_model: DEEPSEEK,
  search_analyzer_model: DEEPSEEK,
  note_judge_model: DEEPSEEK,
  web_search: "serper",
  video_description_strategy: "frames",
  parallel_research: false,
  reasoning_effort: "high",
  temperature: 0,
};

export interface PrefilterVerdict {
  needsNote: boolean;
  reasoning: string;
}

// Empty query lists vary even at temperature zero; require three before rejecting.
async function runQueryWriterRetryOnEmpty(userMessage: string, signal: AbortSignal): Promise<{ queries: string[]; attempts: number }> {
  let queries: string[] = [];
  let attempts = 0;
  for (; attempts < QUERY_WRITER_MAX_ATTEMPTS; ) {
    signal.throwIfAborted();
    attempts++;
    queries = (await runQueryWriter(userMessage)).queries;
    signal.throwIfAborted();
    if (queries.length > 0) break;
  }
  getTweetLog()?.set(`${STEP.queryWriter}.attempts`, attempts);
  return { queries, attempts };
}

/** Return a research brief, or null when every search is empty. */
async function gatherFindings(userMessage: string, queries: string[], signal: AbortSignal): Promise<string | null> {
  const sections: string[] = [];
  let total = 0;
  for (const q of queries) {
    signal.throwIfAborted();
    let results: SearchResult[] = [];
    try {
      results = await fetchSearchResults(q, signal);
    } catch {
      signal.throwIfAborted();
      // One failed query should not sink the whole prefilter.
    }
    signal.throwIfAborted();
    const top = results.slice(0, MAX_RESULTS_PER_QUERY);
    total += top.length;
    sections.push(`## Query: ${q}\n${formatSearchResults(top)}`);
  }
  const rawFindings = sections.join("\n\n");
  const log = getTweetLog();
  log?.set(`${STEP.fetchAndFormatSearch}.findings`, rawFindings.slice(0, 4000));
  log?.set(`${STEP.fetchAndFormatSearch}.resultCount`, total);
  if (total === 0) return null;
  log?.set("note_prefilter_steps.activeStage", "search_analyzer");
  return runSearchAnalyzer(userMessage, rawFindings);
}

async function runPrefilterJudge(postContext: string, findings: string): Promise<{ needsNote: boolean; reasoning: string }> {
  const log = getTweetLog();
  const userMessage = buildPrefilterJudgeUserMessage(postContext, findings);
  log?.set(`${STEP.noteNeededJudge}.messages.0`, { systemPrompt: PREFILTER_JUDGE_SYSTEM_PROMPT, userMessage, model: DEEPSEEK });
  const parsed = await runJsonLlmCall<{ note_needed: boolean; reasoning: string }>({
    costName: COST.noteNeededJudge,
    model: DEEPSEEK,
    messages: [
      { role: "system", content: PREFILTER_JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    responseFormat: PREFILTER_JUDGE_RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "note_needed": boolean }`,
  });
  log?.set(`${STEP.noteNeededJudge}.messages.1`, { content: parsed });
  return { needsNote: !!parsed.note_needed, reasoning: parsed.reasoning ?? "" };
}

async function runPrefilterSteps(userMessage: string, signal: AbortSignal): Promise<PrefilterVerdict> {
  const stage = (name: string) => {
    signal.throwIfAborted();
    getTweetLog()?.set("note_prefilter_steps.activeStage", name);
  };
  stage("satire_detector");
  const satire = await runSatireDetector(userMessage);
  signal.throwIfAborted();
  if (satire.isSatire) {
    return { needsNote: false, reasoning: `overt satire — ${satire.reasoning}` };
  }

  stage("query_writer");
  const { queries } = await runQueryWriterRetryOnEmpty(userMessage, signal);
  if (queries.length === 0) {
    return { needsNote: false, reasoning: "query writer returned no queries — opinion/joke/non-checkable" };
  }

  stage("search");
  const findings = await gatherFindings(userMessage, queries, signal);
  signal.throwIfAborted();
  if (!findings) {
    // Empty searches can mean an outage; let the full bot decide.
    return { needsNote: true, reasoning: "search returned zero results for every query — failing open, the bot's own search and gates decide" };
  }

  stage("note_needed_judge");
  const judge = await runPrefilterJudge(userMessage, findings);
  signal.throwIfAborted();
  return { needsNote: judge.needsNote, reasoning: judge.reasoning };
}

/** Isolate prefilter logs and costs, then fold them into the caller's record. */
export async function runNoteNeededPrefilter(
  userMessage: string,
  { deadlineMs = PREFILTER_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<PrefilterVerdict> {
  const outerLog = getTweetLog();
  const stepLog: TweetLogMap = createTweetLog();
  let costs: ReturnType<typeof getCostTracker> = [];
  const startedAt = Date.now();

  try {
    const verdict = await withBotConfig(PREFILTER_CONFIG, () =>
      withTweetLog(stepLog, () =>
        withCostTracker(() => {
          costs = getCostTracker();
          return withDeadline(
            deadlineMs,
            () => new PrefilterDeadlineError(deadlineMs),
            (signal) => withLlmAbortSignal(signal, () => runPrefilterSteps(userMessage, signal)),
          );
        }),
      ),
    );
    stepLog.set("note_prefilter_steps.verdict", verdict);
    return verdict;
  } catch (err) {
    if (!(err instanceof PrefilterDeadlineError)) throw err;
    const verdict = {
      needsNote: true,
      reasoning: `${err.message} — failing open, the bot's own research and gates decide`,
    };
    stepLog.set("note_prefilter_steps.timeout", {
      deadlineMs,
      stage: stepLog.get("note_prefilter_steps.activeStage"),
      action: "fail_open",
    });
    stepLog.set("note_prefilter_steps.verdict", verdict);
    addWarning(verdict.reasoning);
    console.warn(`[prefilter] ${verdict.reasoning}`);
    return verdict;
  } finally {
    stepLog.set("note_prefilter_steps.elapsedMs", Date.now() - startedAt);
    // Preserve completed steps and costs on timeout or error as well as success.
    for (const [key, value] of stepLog) {
      outerLog?.set(key.replace(/^note_writer_steps\b/, "note_prefilter_steps"), value);
    }
    for (const entry of costs) {
      trackLlmCall({ ...entry, name: `note_prefilter.${entry.name}` });
    }
  }
}
