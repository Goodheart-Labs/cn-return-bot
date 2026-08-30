/**
 * The note-needed prefilter is a cheap deepseek-v4-flash gate. It decides
 * whether a post is worth running the full and expensive bot on. Its steps run
 * in order: the query writer, then SearXNG, then the search analyzer. Last
 * comes a reframed note-needed judge. That judge sees the post
 * and the research brief but no proposed note, and answers whether the post
 * needs a note at all. The prefilter never writes a note and never verifies
 * sources.
 *
 * It runs on a large feed, which generateCandidates assembles. It screens many
 * posts cheaply, and only the ones it flags reach the bot. We validated it
 * offline against simple-bot's own decisions. It missed about 10% of the posts
 * simple-bot would have noted, and it correctly filtered out 72% of the rest.
 * See src/scripts_jim/2026_06_06_deepseek_note_filter.
 *
 * The query writer is not deterministic even at temperature 0. On identical
 * input it flips between an empty list and real queries. So we retry while it
 * returns an empty list. We stop at the first non-empty result, and we accept
 * "no queries" only after QUERY_WRITER_MAX_ATTEMPTS empty answers.
 */
import { withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import {
  PREFILTER_JUDGE_SYSTEM_PROMPT,
  PREFILTER_JUDGE_RESPONSE_FORMAT,
  buildPrefilterJudgeUserMessage,
} from "../prompts/prefilter/noteNeededJudge";
import { runQueryWriter } from "./queryWriter";
import { runSearchAnalyzer } from "./searchAnalyzer";
import { fetchSearxngResults, formatSearxngResults, type SearxngResult } from "../tool-calling/tools";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { createTweetLog, withTweetLog, getTweetLog, type TweetLogMap } from "../utils/tweetLog";
import { withCostTracker, getCostTracker, trackLlmCall } from "../cost-tracking/costTracker";
import { STEP, COST } from "../utils/noteWriterSteps";

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const MAX_RESULTS_PER_QUERY = 6;
const QUERY_WRITER_MAX_ATTEMPTS = 3;

/** The self-contained config for the prefilter's own steps. Every call runs on
 *  deepseek-v4-flash and searches through SearXNG, with reasoning effort high
 *  and temperature 0, the deterministic settings. We enter it
 *  with withBotConfig so the config of the bot that was picked stays untouched.
 *  The video_description_strategy field is required by the type but unused here,
 *  because the caller builds the bot input, not this file. */
const PREFILTER_CONFIG: BotConfig = {
  botId: "note-needed-prefilter",
  model: DEEPSEEK,
  search_model: DEEPSEEK,
  search_analyzer_model: DEEPSEEK,
  note_judge_model: DEEPSEEK,
  web_search: "searxng",
  video_description_strategy: "frames",
  parallel_research: false,
  reasoning_effort: "high",
  temperature: 0,
};

export interface PrefilterVerdict {
  needsNote: boolean;
  reasoning: string;
}

/** Runs the query writer and retries it while it returns no queries. The file
 *  header explains why. runQueryWriter logs its own messages.0 and messages.1
 *  and its cost under the query_writer step. Here we add the attempt count. */
async function runQueryWriterRetryOnEmpty(userMessage: string): Promise<{ queries: string[]; attempts: number }> {
  let queries: string[] = [];
  let attempts = 0;
  for (; attempts < QUERY_WRITER_MAX_ATTEMPTS; ) {
    attempts++;
    queries = (await runQueryWriter(userMessage)).queries;
    if (queries.length > 0) break;
  }
  getTweetLog()?.set(`${STEP.queryWriter}.attempts`, attempts);
  return { queries, attempts };
}

/** Fetches SearXNG results for every query and hands them to the search
 *  analyzer, which turns them into a research brief. Returns null when not a
 *  single query produced a result. */
async function gatherFindings(userMessage: string, queries: string[]): Promise<string | null> {
  const sections: string[] = [];
  let total = 0;
  for (const q of queries) {
    let results: SearxngResult[] = [];
    try {
      results = await fetchSearxngResults(q);
    } catch {
      // One failed query should not sink the whole prefilter.
    }
    const top = results.slice(0, MAX_RESULTS_PER_QUERY);
    total += top.length;
    sections.push(`## Query: ${q}\n${formatSearxngResults(top)}`);
  }
  const rawFindings = sections.join("\n\n");
  const log = getTweetLog();
  log?.set(`${STEP.fetchAndFormatSearch}.findings`, rawFindings.slice(0, 4000));
  log?.set(`${STEP.fetchAndFormatSearch}.resultCount`, total);
  if (total === 0) return null;
  // runSearchAnalyzer logs its own messages.0 and messages.1 and its cost under
  // the search_analyzer step.
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

/** Runs the prefilter's steps under the deepseek config. The shared steps are
 *  the query writer, the search, the analyzer and the judge. Each of them logs
 *  its own messages.0 and messages.1 and its cost to the active tweet log and
 *  cost tracker. The caller isolates that log and that tracker, so the entries
 *  land in the prefilter's own namespace instead of the bot's. */
async function runPrefilterSteps(userMessage: string): Promise<PrefilterVerdict> {
  const { queries } = await runQueryWriterRetryOnEmpty(userMessage);
  if (queries.length === 0) {
    return { needsNote: false, reasoning: "query writer returned no queries — opinion/joke/non-checkable" };
  }

  const findings = await gatherFindings(userMessage, queries);
  if (!findings) {
    // Fail OPEN. Zero results across every query almost never means the claim
    // is unsearchable — on a healthy day it happens ~2 times. It means the
    // search layer is broken, and treating blindness as absence is how a
    // broken search layer silently rejected the entire feed for days in Aug
    // 2026 (submissions ~90/day -> 6/day, every CI run green). Passing the
    // post through costs one full-bot run, and the bot still has its own
    // native search plus the note-needed judge, the eval gate, and the source
    // verifier between here and a submission.
    return { needsNote: true, reasoning: "search returned zero results for every query — failing open, the bot's own search and gates decide" };
  }

  const judge = await runPrefilterJudge(userMessage, findings);
  return { needsNote: judge.needsNote, reasoning: judge.reasoning };
}

/**
 * Decides whether the post in `userMessage` needs a note. That message is the
 * shared bot-input user message, which processSingleTweet builds once.
 * The steps run under their own deepseek config, and in a tweet log and a cost
 * tracker that are isolated from the caller's.
 * Afterwards the step logs are grafted onto the caller's log under
 * `note_prefilter_steps.*`. That sits parallel to the bot's own
 * `note_writer_steps.*`, so the two can never collide.
 * The cost entries are re-emitted under `note_prefilter.*`, so the whole
 * prefilter shows up as a single cost group.
 */
export async function runNoteNeededPrefilter(userMessage: string): Promise<PrefilterVerdict> {
  const outerLog = getTweetLog();
  const stepLog: TweetLogMap = createTweetLog();

  const { verdict, costs } = await withBotConfig(PREFILTER_CONFIG, () =>
    withTweetLog(stepLog, () =>
      withCostTracker(async () => {
        const verdict = await runPrefilterSteps(userMessage);
        return { verdict, costs: [...getCostTracker()] };
      }),
    ),
  );

  if (outerLog) {
    // Graft the LLM step logs under note_prefilter_steps.*.
    for (const [key, value] of stepLog) {
      outerLog.set(key.replace(/^note_writer_steps\b/, "note_prefilter_steps"), value);
    }
    outerLog.set("note_prefilter_steps.verdict", verdict);
  }

  // Fold the prefilter's costs into the run total. Each entry name gets the
  // "note_prefilter" prefix, so the entries group together instead of colliding
  // with the bot's steps of the same name.
  for (const entry of costs) {
    trackLlmCall({ ...entry, name: `note_prefilter.${entry.name}` });
  }

  return verdict;
}
