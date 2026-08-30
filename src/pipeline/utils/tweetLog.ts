/**
 * Tweet log.
 *
 * This module provides structured per-tweet logging built on AsyncLocalStorage.
 * Each tweet being processed gets its own isolated Map. Any function in the
 * call stack can write to that Map, so we never have to thread a log parameter
 * through every function in between.
 *
 * Pipeline functions call getTweetLog()?.set("key", value) to capture data.
 * generateCandidates.ts wraps each tweet in withTweetLog(). It then prints a
 * compact summary and a collapsible ::group:: JSON dump.
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

/** Returns the current tweet's log. Returns undefined when there is no tweet
 *  context. */
export function getTweetLog(): TweetLogMap | undefined {
  return logStorage.getStore();
}

/** Runs a function inside a tweet log context. */
export function withTweetLog<T>(log: TweetLogMap, fn: () => T): T {
  return logStorage.run(log, fn);
}

/**
 * Returns the short bot id written to the log, for example "simple-bot".
 * Returns the fallback when the pipeline did not get far enough to set it.
 */
export function getLoggedBotId(fallback: string, log?: TweetLogMap): string {
  const source = log ?? getTweetLog();
  return (source?.get("bot.id") as string | undefined) ?? fallback;
}

/**
 * Returns the bot identity captured during the pipeline run, ready to persist
 * in pipeline_runs.
 * `name` is the short bot id, such as "simple-bot" or "agent". It is the same
 * value as ab_test_picks.bot.
 * `picks` holds this run's A/B test picks, such as bot, simple_bot_search and
 * simple_bot_writer.
 * `config` is a snapshot of the fully resolved BotConfig.
 */
export function getLoggedBotIdentity(
  fallbackName: string,
  log?: TweetLogMap,
): { name: string; picks?: Record<string, string>; config?: Record<string, unknown> } {
  const source = log ?? getTweetLog();
  const name = (source?.get("bot.id") as string | undefined) ?? fallbackName;
  const picks = source?.get("bot.picks") as Record<string, string> | undefined;
  const config = source?.get("bot.config") as Record<string, unknown> | undefined;
  return { name, picks, config };
}

// ---------------------------------------------------------------------------
// Dot-key nesting: turning a flat map into a nested object for serialization
// ---------------------------------------------------------------------------

/**
 * Converts a flat map whose keys use dot notation into a nested object.
 * For example {"search.context": "...", "search.model": "sonar"} becomes
 * {search: {context: "...", model: "sonar"}}.
 * Values that are already objects or arrays are carried across untouched. Only
 * the dots in the keys drive the nesting.
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
// Formatting helpers
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
// Per-tweet output formatters
// ---------------------------------------------------------------------------

/** Builds a one-line summary of a tweet's log for quick scanning in the
 *  terminal. */
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

/** Renders the full log as nested JSON. On CI the JSON is wrapped in a
 *  collapsible ::group:: block. Locally it gets a plain header line instead. */
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

/** Builds a summary of all the tweets processed in this run. */
export function formatRunSummary(logs: TweetLogMap[]): string {
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

  const outcomeParts = Object.entries(outcomes)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  lines.push(`  ${logs.length} processed: ${outcomeParts}`);

  if (Object.keys(rejectionReasons).length > 0) {
    const rejParts = Object.entries(rejectionReasons)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    lines.push(`  Rejections: ${rejParts}`);
  }

  if (impressions.length > 0) {
    const total = impressions.reduce((a, b) => a + b, 0);
    const max = Math.max(...impressions);
    lines.push(`  Impressions: median ${fmtCount(median(impressions))}, max ${fmtCount(max)}, total ${fmtCount(total)}`);
  }

  if (recencies.length > 0) {
    const min = Math.min(...recencies);
    const max = Math.max(...recencies);
    lines.push(`  Recency: median ${median(recencies).toFixed(1)}h, min ${min.toFixed(1)}h, max ${max.toFixed(1)}h`);
  }

  const botParts = Object.entries(botUsage)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`  Bot usage: ${botParts}`);

  return lines.join("\n");
}
