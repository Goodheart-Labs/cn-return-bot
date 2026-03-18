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

// ---------------------------------------------------------------------------
// Compact summary formatter
// ---------------------------------------------------------------------------

function get(log: TweetLogMap, key: string): unknown {
  return log.get(key);
}

function formatScoresLine(log: TweetLogMap): string | null {
  const scoreKeys = [...log.keys()].filter((k) => k.startsWith("scores."));
  if (scoreKeys.length === 0) return null;

  const parts = scoreKeys.map((k) => {
    const name = k.replace("scores.", "");
    const val = log.get(k) as { score?: number } | undefined;
    return `${name}=${val?.score?.toFixed(2) ?? "?"}`;
  });
  return `  scores: ${parts.join(" ")}`;
}

function formatMediaLine(log: TweetLogMap): string | null {
  const videos = get(log, "media.videos") as Array<{
    keyFrameDescriptions?: string[];
    transcription?: string;
    durationMs?: number;
  }> | undefined;
  const images = get(log, "media.images") as Array<unknown> | undefined;

  const parts: string[] = [];
  if (videos?.length) {
    for (const v of videos) {
      const details: string[] = [];
      if (v.keyFrameDescriptions?.length) details.push(`${v.keyFrameDescriptions.length} frames`);
      if (v.transcription) details.push(`${v.transcription.length} char transcript`);
      if (v.durationMs) details.push(`${v.durationMs}ms`);
      parts.push(`video${details.length ? ` (${details.join(", ")})` : ""}`);
    }
  }
  if (images?.length) {
    parts.push(`${images.length} image${images.length > 1 ? "s" : ""}`);
  }

  if (parts.length === 0) return null;
  return `  media: ${parts.join(", ")}`;
}

/** Compact multi-line summary for a single tweet — printed atomically */
export function formatTweetLog(log: TweetLogMap): string {
  const index = get(log, "tweet.index") as number | undefined;
  const total = get(log, "tweet.total") as number | undefined;
  const tweetId = get(log, "tweet.id") as string | undefined;
  const botId = get(log, "bot.id") as string | undefined;

  const lines: string[] = [];

  // Header
  lines.push(`--- Tweet ${index ?? "?"}/${total ?? "?"} [${tweetId ?? "?"}] ${botId ?? "?"} ---`);

  // Type
  const tweetType = get(log, "tweet.type") as string | undefined;
  if (tweetType) lines.push(`  type: ${tweetType}`);

  // Media
  const mediaLine = formatMediaLine(log);
  if (mediaLine) lines.push(mediaLine);

  // Search
  const citations = get(log, "search.citations") as string[] | undefined;
  if (citations) lines.push(`  search: ${citations.length} citations`);

  // Note
  const noteStatus = get(log, "note.status") as string | undefined;
  const noteCharCount = get(log, "note.charCount") as number | undefined;
  if (noteStatus) {
    const charPart = noteCharCount != null ? ` (${noteCharCount} chars)` : "";
    lines.push(`  note: "${noteStatus}"${charPart}`);
  }

  // Source check
  const checkResult = get(log, "check.result") as string | undefined;
  if (checkResult) lines.push(`  source check: ${checkResult}`);

  // Evaluation
  const evalScore = get(log, "eval.score") as number | undefined;
  const evalSubmit = get(log, "eval.shouldSubmit") as boolean | undefined;
  if (evalScore != null) {
    const submitPart = evalSubmit != null ? ` (submit=${evalSubmit})` : "";
    lines.push(`  eval: ${evalScore.toFixed(2)}${submitPart}`);
  }

  // Scores
  const scoresLine = formatScoresLine(log);
  if (scoresLine) lines.push(scoresLine);

  // Outcome
  const outcome = get(log, "outcome") as string | undefined;
  const reason = get(log, "outcomeReason") as string | undefined;
  const reasonPart = reason ? ` (${reason})` : "";
  lines.push(`  => ${outcome ?? "unknown"}${reasonPart}`);

  // Warnings
  const warnings = get(log, "warnings") as string[] | undefined;
  if (warnings?.length) {
    for (const w of warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Full JSON dump in GitHub Actions collapsible group
// ---------------------------------------------------------------------------

/** Full log as a ::group:: collapsible section for GitHub Actions */
export function formatTweetLogFull(log: TweetLogMap): string {
  const tweetId = get(log, "tweet.id") as string | undefined;
  const json = JSON.stringify(Object.fromEntries(log), null, 2);
  return `::group::Full log: Tweet ${tweetId ?? "?"}\n${json}\n::endgroup::`;
}

// ---------------------------------------------------------------------------
// Run-level summary
// ---------------------------------------------------------------------------

/** Summary of all tweets processed in this run */
export function formatRunSummary(logs: TweetLogMap[]): string {
  const outcomes: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  const botUsage: Record<string, number> = {};

  for (const log of logs) {
    const outcome = get(log, "outcome") as string | undefined ?? "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    if (outcome === "rejected") {
      const reason = get(log, "outcomeReason") as string | undefined ?? "unknown";
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }

    const botId = get(log, "bot.id") as string | undefined ?? "unknown";
    botUsage[botId] = (botUsage[botId] ?? 0) + 1;
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

  // Bot usage
  const botParts = Object.entries(botUsage)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`  Bot usage: ${botParts}`);

  return lines.join("\n");
}
