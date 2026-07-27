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
 * Short bot id written to the log (e.g. "simple-bot"). Falls back if the
 * pipeline didn't get far enough to set it.
 */
export function getLoggedBotId(fallback: string, log?: TweetLogMap): string {
  const source = log ?? getTweetLog();
  return (source?.get("bot.id") as string | undefined) ?? fallback;
}

/**
 * Bot identity captured at pipeline-run time, ready to persist in pipeline_runs.
 * - `name`: short bot id ("simple-bot", "agent", ...) — equals ab_test_picks.bot.
 * - `picks`: dictionary of A/B test picks for this run (e.g. { bot, simple_bot_search, simple_bot_writer }).
 * - `config`: full resolved BotConfig snapshot.
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

  // Bot usage
  const botParts = Object.entries(botUsage)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`  Bot usage: ${botParts}`);

  return lines.join("\n");
}
