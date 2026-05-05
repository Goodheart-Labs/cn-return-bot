/**
 * Tweet Log
 *
 * Structured per-tweet logging using AsyncLocalStorage.
 * Each concurrent tweet gets its own isolated Map that any function
 * in the call stack can write to without parameter threading.
 *
 * Pipeline functions call getTweetLog()?.set("key", value) to capture data.
 * generateCandidates.ts wraps each tweet in withTweetLog() and prints
 * a compact summary + a collapsible ::group:: JSON dump.
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type TweetLogMap = Map<string, unknown>;

const logStorage = new AsyncLocalStorage<TweetLogMap>();

export function createTweetLog(): TweetLogMap {
  return new Map();
}

/** Get the current tweet's log (undefined if not in a tweet context) */
export function getTweetLog(): TweetLogMap | undefined {
  return logStorage.getStore();
}

/** Run a function within a tweet log context */
export function withTweetLog<T>(log: TweetLogMap, fn: () => T): T {
  return logStorage.run(log, fn);
}

/**
 * Bot id written to the log by the bot that ran — includes config variant
 * (e.g. "agent_gemini-flash-searxng"). Falls back to the bare bot id if the
 * bot didn't write one.
 */
export function getLoggedBotId(fallback: string, log?: TweetLogMap): string {
  const source = log ?? getTweetLog();
  return (source?.get("bot.id") as string | undefined) ?? fallback;
}

/**
 * Bot identity captured by the bot at runtime, ready to be persisted in the
 * pipeline_runs row. `name` is the short family ("claude-simple"); `nameLong`
 * includes the config variant ("claude-simple_claude-simple-sonnet-gemini");
 * `config` is the full BotConfig snapshot for the run.
 */
export function getLoggedBotIdentity(
  fallbackName: string,
  log?: TweetLogMap,
): { name: string; nameLong: string; config?: Record<string, unknown> } {
  const source = log ?? getTweetLog();
  const nameLong = (source?.get("bot.id") as string | undefined) ?? fallbackName;
  const name = (source?.get("bot.name") as string | undefined) ?? fallbackName;
  const config = source?.get("bot.config") as Record<string, unknown> | undefined;
  return { name, nameLong, config };
}

// ---------------------------------------------------------------------------
// LLM call logging helper
// ---------------------------------------------------------------------------

/** Flatten an OpenAI messages array into a single readable string. */
export function formatLlmMessages(messages: any[]): string {
  return messages
    .map((msg: any) => {
      const role = msg.role as string;
      let content: string;
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((part: any) => {
            if (part.type === "text") return part.text;
            if (part.type === "image_url") return "[image]";
            return "";
          })
          .filter(Boolean)
          .join("\n");
      } else {
        content = String(msg.content ?? "");
      }
      return `[${role}]\n${content}`;
    })
    .join("\n\n");
}

/**
 * Log an LLM call under a named label.
 * Writes `<label>.context`, `<label>.response`, `<label>.durationMs`.
 */
export function logLlmCall(
  label: string,
  messages: any[],
  response: string,
  durationMs: number
) {
  const log = getTweetLog();
  if (!log) return;
  log.set(`${label}.context`, formatLlmMessages(messages));
  log.set(`${label}.response`, response);
  log.set(`${label}.durationMs`, durationMs);
}

// ---------------------------------------------------------------------------
// Dot-key nesting (flat map → nested object for serialization)
// ---------------------------------------------------------------------------

/**
 * Convert a flat dot-notation map into a nested object.
 * e.g. {"search.context": "...", "search.model": "sonar"} → {search: {context: "...", model: "sonar"}}
 * Values that are already objects/arrays stay as-is — only the KEY dots drive nesting.
 */
export function nestDotKeys(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let target = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (!target[p] || typeof target[p] !== "object" || Array.isArray(target[p])) {
        target[p] = {};
      }
      target = target[p] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]!] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Compact summary formatter
// ---------------------------------------------------------------------------

function get(log: TweetLogMap, key: string): unknown {
  return log.get(key);
}

function fmtCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

// ---------------------------------------------------------------------------
// Full JSON dump in GitHub Actions collapsible group
// ---------------------------------------------------------------------------

/** One-line summary for quick scanning in terminal */
export function formatTweetLogSummary(log: TweetLogMap): string {
  const post = get(log, "tweet.post") as { id?: string; public_metrics?: { impression_count?: number } } | undefined;
  const index = get(log, "tweet.index") as number | undefined;
  const total = get(log, "tweet.total") as number | undefined;
  const tweetId = post?.id;
  const impressions = post?.public_metrics?.impression_count;
  const outcome = get(log, "outcome.result") as string | undefined;
  const reason = get(log, "outcome.reason") as string | undefined;
  const evalScore = get(log, "eval.score") as number | undefined;
  const noteStatus = get(log, "note.status") as string | undefined;
  const botId = get(log, "bot.id") as string | undefined;

  const parts: string[] = [];
  if (index != null && total != null) parts.push(`[${index}/${total}]`);
  if (tweetId) parts.push(tweetId);
  if (impressions != null) parts.push(`${fmtCount(impressions)} imp`);
  if (botId) parts.push(botId);
  if (outcome) {
    const outcomeStr = reason ? `${outcome} (${reason})` : outcome;
    parts.push(outcomeStr);
  }
  if (noteStatus && noteStatus !== "ERROR") parts.push(noteStatus);
  if (evalScore != null) parts.push(`eval=${evalScore.toFixed(2)}`);

  return parts.join(" | ");
}

/** Full log as nested JSON — collapsible ::group:: on CI, compact on local terminal */
export function formatTweetLogFull(log: TweetLogMap): string {
  const post = get(log, "tweet.post") as { id?: string } | undefined;
  const label = `Full log: Tweet ${post?.id ?? "?"}`;
  const json = JSON.stringify(nestDotKeys(Object.fromEntries(log)), null, 2);
  if (process.env.CI) {
    return `::group::${label}\n${json}\n::endgroup::`;
  }
  return `--- ${label} ---\n${json}`;
}

// ---------------------------------------------------------------------------
// Run-level summary
// ---------------------------------------------------------------------------

/** Summary of all tweets processed in this run */
export function formatRunSummary(logs: TweetLogMap[], feedSize?: string): string {
  const outcomes: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  const botUsage: Record<string, number> = {};
  const impressions: number[] = [];
  const recencies: number[] = [];

  for (const log of logs) {
    const outcome = get(log, "outcome.result") as string | undefined ?? "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    if (outcome === "rejected") {
      const reason = get(log, "outcome.reason") as string | undefined ?? "unknown";
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }

    const botId = get(log, "bot.id") as string | undefined ?? "unknown";
    botUsage[botId] = (botUsage[botId] ?? 0) + 1;

    const post = get(log, "tweet.post") as { public_metrics?: { impression_count?: number } } | undefined;
    const imp = post?.public_metrics?.impression_count;
    if (imp != null) impressions.push(imp);

    const recency = get(log, "tweet.recencyHours") as number | undefined;
    if (recency != null) recencies.push(recency);
  }

  const lines: string[] = [];
  lines.push("[generate] === Summary ===");

  // Outcome counts
  const outcomeParts = Object.entries(outcomes)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  lines.push(`  ${logs.length} processed: ${outcomeParts}`);

  // Rejection breakdown
  if (Object.keys(rejectionReasons).length > 0) {
    const rejParts = Object.entries(rejectionReasons)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    lines.push(`  Rejections: ${rejParts}`);
  }

  // Impression stats
  if (impressions.length > 0) {
    const total = impressions.reduce((a, b) => a + b, 0);
    const max = Math.max(...impressions);
    lines.push(`  Impressions: median ${fmtCount(median(impressions))}, max ${fmtCount(max)}, total ${fmtCount(total)}`);
  }

  // Recency stats
  if (recencies.length > 0) {
    const min = Math.min(...recencies);
    const max = Math.max(...recencies);
    lines.push(`  Recency: median ${median(recencies).toFixed(1)}h, min ${min.toFixed(1)}h, max ${max.toFixed(1)}h`);
  }

  // Feed size
  if (feedSize) {
    lines.push(`  Feed size: ${feedSize}`);
  }

  // Bot usage
  const botParts = Object.entries(botUsage)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`  Bot usage: ${botParts}`);

  return lines.join("\n");
}
