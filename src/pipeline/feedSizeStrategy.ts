/**
 * Feed Size Strategy
 *
 * Determines which feed size (small/large/xl) to request from the
 * eligible posts API based on persistent pipeline state.
 *
 * Rules:
 *   - Bottlenecked (writing limit ≤ 5) → small
 *   - Otherwise → at least large
 *   - At large, 3 consecutive days without hitting limit → xl
 *   - At xl, 3 consecutive days hitting limit → back to large
 */

import type { SupabaseLogger } from "../api/supabaseClient";

type FeedSize = "small" | "large" | "xl";

const FEED_SIZE_LADDER: FeedSize[] = ["small", "large", "xl"];
const DAYS_TO_ESCALATE = 3;
const DAYS_TO_DEESCALATE = 3;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampFeedSize(size: string | null): FeedSize {
  if (size === "large" || size === "xl") return size;
  return "small";
}

function stepUp(size: FeedSize): FeedSize {
  const idx = FEED_SIZE_LADDER.indexOf(size);
  return FEED_SIZE_LADDER[Math.min(idx + 1, FEED_SIZE_LADDER.length - 1)] ?? size;
}

function stepDown(size: FeedSize): FeedSize {
  const idx = FEED_SIZE_LADDER.indexOf(size);
  return FEED_SIZE_LADDER[Math.max(idx - 1, 0)] ?? size;
}

export async function determineFeedSize(
  logger: SupabaseLogger
): Promise<{ feedSize: FeedSize; reason: string }> {
  const [
    rawFeedSize,
    rawBottlenecked,
    rawDaysWithout,
    rawDaysWith,
    rawLimitHitToday,
    rawLastCheckDate,
  ] = await Promise.all([
    logger.getPipelineState("feed_size"),
    logger.getPipelineState("bottlenecked"),
    logger.getPipelineState("days_without_limit_hit"),
    logger.getPipelineState("days_with_limit_hit"),
    logger.getPipelineState("limit_hit_today"),
    logger.getPipelineState("last_limit_check_date"),
  ]);

  let currentSize = clampFeedSize(rawFeedSize);
  let daysWithoutHit = parseInt(rawDaysWithout ?? "0", 10) || 0;
  let daysWithHit = parseInt(rawDaysWith ?? "0", 10) || 0;
  const limitHitToday = rawLimitHitToday === "true";
  const lastCheckDate = rawLastCheckDate;
  const today = todayDateString();

  // Handle day boundary: rotate counters
  if (lastCheckDate && lastCheckDate !== today) {
    if (limitHitToday) {
      daysWithHit++;
      daysWithoutHit = 0;
    } else {
      daysWithoutHit++;
      daysWithHit = 0;
    }

    // Persist rotated counters and reset today's flag
    await Promise.all([
      logger.setPipelineState("days_without_limit_hit", String(daysWithoutHit)),
      logger.setPipelineState("days_with_limit_hit", String(daysWithHit)),
      logger.setPipelineState("limit_hit_today", "false"),
    ]);
  }

  // Always update the check date
  if (lastCheckDate !== today) {
    await logger.setPipelineState("last_limit_check_date", today);
  }

  // No history → start with small
  if (!rawFeedSize) {
    await logger.setPipelineState("feed_size", "small");
    return { feedSize: "small", reason: "no history, starting conservative" };
  }

  // Bottlenecked (writing limit ≤ 5) → small
  if (rawBottlenecked === "true") {
    if (currentSize !== "small") {
      await logger.setPipelineState("feed_size", "small");
    }
    return { feedSize: "small", reason: "bottlenecked (writing limit ≤ 5)" };
  }

  // Not bottlenecked → at least large
  if (currentSize === "small") {
    currentSize = "large";
  }

  // Escalation: at large, 3+ days without hitting limit → xl
  if (currentSize === "large" && daysWithoutHit >= DAYS_TO_ESCALATE) {
    currentSize = stepUp(currentSize);
  }

  // De-escalation: at xl, 3+ days hitting limit → back to large
  if (currentSize === "xl" && daysWithHit >= DAYS_TO_DEESCALATE) {
    currentSize = stepDown(currentSize);
  }

  await logger.setPipelineState("feed_size", currentSize);

  const parts = [`${daysWithoutHit}d without limit`, `${daysWithHit}d with limit`];
  return { feedSize: currentSize, reason: parts.join(", ") };
}

export function buildPostSelection(feedSize: FeedSize): string {
  return `feed_size: ${feedSize}, feed_lang: en`;
}
