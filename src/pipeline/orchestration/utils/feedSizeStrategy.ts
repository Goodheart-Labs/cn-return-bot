/**
 * Feed Size Strategy
 *
 * Determines which feed size to request from the eligible posts API.
 * Currently hardcoded to "small" — we lost access to "large" feed (403) as of 2026-03-25.
 */

import type { SupabaseLogger } from "../../../api/supabaseClient";

export type FeedSize = "small" | "large" | "xl";

export async function determineFeedSize(
  _logger: SupabaseLogger
): Promise<{ feedSize: FeedSize; reason: string }> {
  // Hardcoded to small — we lost access to "large" feed (403) as of 2026-03-25
  return { feedSize: "small", reason: "hardcoded small (large feed 403)" };

  /*
  const [feedSize, writingLimitStr, daysWithout, daysWith, limitHitToday, lastCheckDate] =
    await Promise.all([
      logger.getPipelineState("feed_size"),
      logger.getPipelineState("writing_limit"),
      logger.getPipelineState("days_without_limit_hit"),
      logger.getPipelineState("days_with_limit_hit"),
      logger.getPipelineState("limit_hit_today"),
      logger.getPipelineState("last_limit_check_date"),
    ]);

  let currentSize: FeedSize =
    feedSize === "large" || feedSize === "xl" ? feedSize : "small";
  let daysWithoutHit = parseInt(daysWithout ?? "0", 10) || 0;
  let daysWithHit = parseInt(daysWith ?? "0", 10) || 0;
  const today = todayDateString();

  // Handle day boundary: rotate counters
  if (lastCheckDate && lastCheckDate !== today) {
    if (limitHitToday === "true") {
      daysWithHit++;
      daysWithoutHit = 0;
    } else {
      daysWithoutHit++;
      daysWithHit = 0;
    }

    await Promise.all([
      logger.setPipelineState("days_without_limit_hit", String(daysWithoutHit)),
      logger.setPipelineState("days_with_limit_hit", String(daysWithHit)),
      logger.setPipelineState("limit_hit_today", "false"),
    ]);
  }

  if (lastCheckDate !== today) {
    await logger.setPipelineState("last_limit_check_date", today);
  }

  // No history → start with small
  if (!feedSize) {
    await logger.setPipelineState("feed_size", "small");
    return { feedSize: "small", reason: "no history, starting conservative" };
  }

  const writingLimit = writingLimitStr ? parseInt(writingLimitStr, 10) : null;
  if (writingLimit !== null && writingLimit <= 5) {
    if (currentSize !== "small") {
      await logger.setPipelineState("feed_size", "small");
    }
    return { feedSize: "small", reason: `writing limit ${writingLimit} ≤ 5` };
  }

  // Not bottlenecked → at least large
  if (currentSize === "small") {
    currentSize = "large";
  }

  // Escalation: at large, 3+ days without hitting limit → xl
  if (currentSize === "large" && daysWithoutHit >= DAYS_TO_ESCALATE) {
    currentSize = "xl";
  }

  // De-escalation: at xl, 3+ days hitting limit → back to large
  if (currentSize === "xl" && daysWithHit >= DAYS_TO_DEESCALATE) {
    currentSize = "large";
  }

  await logger.setPipelineState("feed_size", currentSize);

  const parts = [`${daysWithoutHit}d without limit`, `${daysWithHit}d with limit`];
  return { feedSize: currentSize, reason: parts.join(", ") };
  */
}

export function buildPostSelection(feedSize: FeedSize): string {
  return `feed_size: ${feedSize}, feed_lang: en`;
}

/*
const DAYS_TO_ESCALATE = 3;
const DAYS_TO_DEESCALATE = 3;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
*/
