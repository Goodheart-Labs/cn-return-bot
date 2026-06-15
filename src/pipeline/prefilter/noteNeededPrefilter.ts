/**
 * Note-needed prefilter — a cheap deepseek-v4-flash gate that decides whether a
 * post is worth running the full (expensive) bot on. Reuses the cheap-bot steps
 * — query writer → SearXNG → search analyzer — then a reframed note-needed judge
 * (no proposed note: post + research brief → needs a note?). No note-writing, no
 * source verification.
 *
 * Runs on a large feed (see generateCandidates): the prefilter screens many
 * posts cheaply and only the ones it flags reach the bot. Validated offline at
 * ~10% false-negative / 72% correctly-filtered vs simple-bot's own decisions
 * (see src/scripts_jim/2026_06_06_deepseek_note_filter).
 *
 * The query writer is non-deterministic even at temp 0 (it flips between [] and
 * real queries on identical input), so we retry-on-empty: re-roll only while it
 * returns [], stop on the first non-empty result, accept "no queries" only after
 * QUERY_WRITER_MAX_ATTEMPTS empties.
 */
import type { Post } from "../../api/fetchEligiblePosts";
import { withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import { createBotInput } from "../input/createBotInput";
import { buildUserMessageFromInput } from "../input/prompt";
import { runQueryWriter } from "../cheap-bot/queryWriter";
import { runSearchAnalyzer } from "../cheap-bot/searchAnalyzer";
import { fetchSearxngResults, formatSearxngResults, type SearxngResult } from "../tool-calling/tools";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { createTweetLog, withTweetLog, getTweetLog, type TweetLogMap } from "../utils/tweetLog";
import { withCostTracker, getCostTracker, trackLlmCall } from "../cost-tracking/costTracker";
import { STEP, COST } from "../utils/noteWriterSteps";

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const MAX_RESULTS_PER_QUERY = 6;
const QUERY_WRITER_MAX_ATTEMPTS = 3;

/** Self-contained config for the prefilter's own steps — every call on
 *  deepseek-v4-flash, SearXNG, reasoning high + temp 0 (matches cheap-bot's
 *  deterministic settings). Entered with withBotConfig so the picked bot's
 *  config is untouched. */
const PREFILTER_CONFIG: BotConfig = {
  botId: "note-needed-prefilter",
  model: DEEPSEEK,
  search_model: DEEPSEEK,
  search_analyzer_model: DEEPSEEK,
  note_judge_model: DEEPSEEK,
  web_search: "searxng",
  video_description_strategy: "frames",
  parallel_research: false,
  search_analyzer: true,
  reasoning_effort: "high",
  temperature: 0,
  feed_size: "small",
  eval_submit_threshold: 0, // unused — prefilter runs before the bot / eval gate
};

// Reframed note-needed judge: same three preconditions as the real cheap-bot
// judge (src/pipeline/simple-bot/judge.ts), but it receives post + research
// findings instead of a proposed note (the prefilter skips the writer).
const JUDGE_SYSTEM_PROMPT = `You are a Community Notes quality judge for X/Twitter. You receive an original post and research findings from a web search. Decide whether the post NEEDS a Community Note.

A note is needed ONLY if all three hold:
1. **Falsifiable fact** — the post asserts a specific, checkable claim about a past or present state of the world. NOT a prediction, opinion, value judgment, or rhetorical generalization.
2. **Materially false** — that claim is actually false or materially misleading against the research findings; not merely reframed, incomplete, or pedantic.
3. **Sincere, not satire** — the post presents the claim as sincere fact, not obvious satire, parody, or a recognizable joke/meme (judged from the post itself, not a bio label).

If any fails, return note_needed=false. The note must address a claim the post actually makes — but a false superlative or absolute the post asserts ("lowest ever", "the first", "none") IS such a claim, not a tangential detail.

## Common abstain cases
- **Predictions / unresolved matters** — the claim is about a future or not-yet-settled event.
- **Accurate but reframed** — the underlying claim is true and a note would only re-spin it. If the findings say the claim is essentially accurate, abstain.
- **Author already disclosed** — the author truthfully states the content's nature (AI-generated, satire, fiction).
- **Pedantic** — a recency or detail nitpick that doesn't change the claim's meaning.
- **Self-disambiguating post** — the post's OWN media or caption reveals its non-serious nature, or is itself the corrective evidence. Corrective *replies* do NOT count — they don't travel with the post.

## Exception — fabricated quotes / non-events
"No evidence found" is sufficient grounds for a note ONLY when correcting a fabricated quote or a non-event ("X never said Y", "Z did not happen") attributed to a real public figure with no in-tweet disambiguation.

Return JSON with two fields:
- reasoning: one or two sentences, written BEFORE the verdict.
- note_needed: boolean. True only if all three preconditions hold.`;

const JUDGE_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "prefilter_note_needed",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reasoning: { type: "string" },
        note_needed: { type: "boolean" },
      },
      required: ["reasoning", "note_needed"],
      additionalProperties: false,
    },
  },
};

export interface PrefilterVerdict {
  needsNote: boolean;
  reasoning: string;
}

/** Query writer with retry-on-empty (see file header). runQueryWriter logs its
 *  own messages.0/1 + cost under the query_writer step; we add the attempt count. */
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

/** SearXNG fetch over all queries → search analyzer brief. Null if no results. */
async function gatherFindings(userMessage: string, queries: string[]): Promise<string | null> {
  const sections: string[] = [];
  let total = 0;
  for (const q of queries) {
    let results: SearxngResult[] = [];
    try {
      results = await fetchSearxngResults(q);
    } catch {
      // a single failed query shouldn't sink the prefilter
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
  // runSearchAnalyzer logs its own messages.0/1 + cost under the search_analyzer step.
  return runSearchAnalyzer(userMessage, rawFindings);
}

async function runPrefilterJudge(postContext: string, findings: string): Promise<{ needsNote: boolean; reasoning: string }> {
  const log = getTweetLog();
  const userMessage = `## Original post\n${postContext}\n\n## Research findings\n${findings}`;
  log?.set(`${STEP.noteNeededJudge}.messages.0`, { systemPrompt: JUDGE_SYSTEM_PROMPT, userMessage, model: DEEPSEEK });
  const parsed = await runJsonLlmCall<{ note_needed: boolean; reasoning: string }>({
    costName: COST.noteNeededJudge,
    model: DEEPSEEK,
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    responseFormat: JUDGE_RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "note_needed": boolean }`,
  });
  log?.set(`${STEP.noteNeededJudge}.messages.1`, { content: parsed });
  return { needsNote: !!parsed.note_needed, reasoning: parsed.reasoning ?? "" };
}

/** The prefilter's steps, run under the deepseek config. Each shared step
 *  (query writer, search, analyzer, judge) logs its own messages.0/1 + cost to
 *  the active tweet-log/cost-tracker — which the caller isolates so they land in
 *  the prefilter's own namespace, not the bot's. */
async function runPrefilterSteps(post: Post): Promise<PrefilterVerdict> {
  const input = await createBotInput(post, `prefilter:${post.id}`);
  const userMessage = buildUserMessageFromInput(post, input);

  const { queries } = await runQueryWriterRetryOnEmpty(userMessage);
  if (queries.length === 0) {
    return { needsNote: false, reasoning: "query writer returned no queries — opinion/joke/non-checkable" };
  }

  const findings = await gatherFindings(userMessage, queries);
  if (!findings) {
    return { needsNote: false, reasoning: "no evidence found — every query returned zero results" };
  }

  const judge = await runPrefilterJudge(userMessage, findings);
  return { needsNote: judge.needsNote, reasoning: judge.reasoning };
}

/**
 * Decide whether `post` needs a note. Builds the full input (createBotInput) —
 * cached in-memory so the bot reuses it when the post passes. Runs under its own
 * deepseek config, in an ISOLATED tweet-log + cost-tracker, then grafts the step
 * logs onto the caller's log under `note_prefilter_steps.*` (parallel to the
 * bot's `note_writer_steps.*`, so the two never collide) and re-emits the cost
 * entries namespaced under `note_prefilter.*` (one cost group for the prefilter).
 */
export async function runNoteNeededPrefilter(post: Post): Promise<PrefilterVerdict> {
  const outerLog = getTweetLog();
  const stepLog: TweetLogMap = createTweetLog();

  const { verdict, costs } = await withBotConfig(PREFILTER_CONFIG, () =>
    withTweetLog(stepLog, () =>
      withCostTracker(async () => {
        const verdict = await runPrefilterSteps(post);
        return { verdict, costs: [...getCostTracker()] };
      }),
    ),
  );

  if (outerLog) {
    // Graft the LLM step logs under note_prefilter_steps.*; input/media logs
    // (inputs.* / media.*) keep their conventional top-level keys.
    for (const [key, value] of stepLog) {
      outerLog.set(key.replace(/^note_writer_steps\b/, "note_prefilter_steps"), value);
    }
    outerLog.set("note_prefilter_steps.verdict", verdict);
  }

  // Fold the prefilter's costs into the run total, namespaced so they group
  // under "note_prefilter" instead of colliding with the bot's same-named steps.
  for (const entry of costs) {
    trackLlmCall({ ...entry, name: `note_prefilter.${entry.name}` });
  }

  return verdict;
}
