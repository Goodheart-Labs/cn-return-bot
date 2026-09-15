/** Enforce excluded topics before research. DeepSeek answers first, Gemini Flash
 *  on any failure. If both fail the post passes with a warning: we would rather
 *  write notes through a provider outage than hold every post on this gate. */
import { withBotConfig, type BotConfig } from "../ab-testing/botConfig";
import { AttemptDeadlineError, withDeadline, withLlmAbortSignal } from "../llm/llm";
import {
  TOPIC_FILTER_SYSTEM_PROMPT,
  TOPIC_FILTER_RESPONSE_FORMAT,
} from "../prompts/prefilter/blockedTopics";
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { ModelOutputInvalidError } from "../utils/errors";
import { getTweetLog } from "../utils/tweetLog";
import { addWarning } from "../utils/warnings";

const DEEPSEEK = "deepseek/deepseek-v4-flash";
const FALLBACK_MODEL = "google/gemini-3-flash-preview";
const PRIMARY_BUDGET_MS = 30_000;
const FALLBACK_BUDGET_MS = 20_000;
const STEP = "topic_filter";

const TOPIC_FILTER_CONFIG: BotConfig = {
  botId: "blocked-topic-filter",
  model: DEEPSEEK,
  web_search: "serper",
  video_description_strategy: "frames",
  parallel_research: false,
  reasoning_effort: "high",
  temperature: 0,
};

export interface TopicFilterVerdict {
  blocked: boolean;
  reasoning: string;
}

function validateVerdict(parsed: unknown): TopicFilterVerdict {
  if (!parsed || typeof parsed !== "object"
    || typeof (parsed as TopicFilterVerdict).blocked !== "boolean"
    || typeof (parsed as TopicFilterVerdict).reasoning !== "string") {
    throw new ModelOutputInvalidError("topic_filter: expected a boolean blocked verdict and string reasoning");
  }
  const { blocked, reasoning } = parsed as TopicFilterVerdict;
  return { blocked, reasoning };
}

async function runAttempt(userMessage: string, fallback: boolean): Promise<TopicFilterVerdict> {
  const log = getTweetLog();
  const model = fallback ? FALLBACK_MODEL : DEEPSEEK;
  const deadlineMs = fallback ? FALLBACK_BUDGET_MS : PRIMARY_BUDGET_MS;
  const attemptKey = `${STEP}.attempts.${fallback ? 1 : 0}`;
  const startedAt = Date.now();
  log?.set(`${STEP}.model`, model);
  log?.set(`${STEP}.messages.0`, { systemPrompt: TOPIC_FILTER_SYSTEM_PROMPT, userMessage, model });
  log?.set(`${attemptKey}.model`, model);
  log?.set(`${attemptKey}.budgetMs`, deadlineMs);
  try {
    return await withBotConfig({
      ...TOPIC_FILTER_CONFIG,
      model,
      reasoning_effort: fallback ? "low" : "high",
    }, () => withDeadline(
      deadlineMs,
      () => new AttemptDeadlineError(model, deadlineMs),
      (signal) => withLlmAbortSignal(signal, async () => {
        const parsed = await runJsonLlmCall<unknown>({
          costName: fallback ? `${STEP}.fallback` : STEP,
          model,
          messages: [
            { role: "system", content: TOPIC_FILTER_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          responseFormat: TOPIC_FILTER_RESPONSE_FORMAT,
          schemaHint: `{ "reasoning": string, "blocked": boolean }`,
        });
        signal.throwIfAborted();
        log?.set(`${attemptKey}.response`, parsed);
        const verdict = validateVerdict(parsed);
        log?.set(`${STEP}.messages.1`, { content: verdict });
        return verdict;
      }),
    ));
  } catch (err) {
    log?.set(`${attemptKey}.error`, String(err).slice(0, 1000));
    throw err;
  } finally {
    log?.set(`${attemptKey}.durationMs`, Date.now() - startedAt);
  }
}

/** If both attempts fail, fail open: the post carries on unchecked, with a warning. */
export async function runBlockedTopicFilter(userMessage: string): Promise<TopicFilterVerdict> {
  const log = getTweetLog();
  let verdict: TopicFilterVerdict;
  try {
    verdict = await runAttempt(userMessage, false);
  } catch (err) {
    const reason = String(err).slice(0, 1000);
    log?.set(`${STEP}.fallbackReason`, reason);
    addWarning(`Blocked-topic filter: ${DEEPSEEK} failed; trying ${FALLBACK_MODEL}: ${reason}`);
    console.warn(`[topic_filter] ${DEEPSEEK} failed; trying ${FALLBACK_MODEL}: ${reason}`);
    try {
      verdict = await runAttempt(userMessage, true);
    } catch (fallbackError) {
      const fallbackReason = String(fallbackError).slice(0, 1000);
      log?.set(`${STEP}.error`, fallbackReason);
      log?.set(`${STEP}.failedOpen`, true);
      verdict = {
        blocked: false,
        reasoning: `both models failed — failing open, the post is not checked for excluded topics: ${fallbackReason}`,
      };
      addWarning(`Blocked-topic filter: ${verdict.reasoning}`);
      console.warn(`[topic_filter] ${verdict.reasoning}`);
    }
  }
  log?.set(`${STEP}.verdict`, verdict);
  return verdict;
}
