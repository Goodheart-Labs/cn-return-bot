/**
 * Feed Size Strategy
 *
 * Determines which feed size (small/large/xl) to request from the
 * eligible posts API based on persistent pipeline state.
 *
 * Rules:
 *   - Bottlenecked (≤5 notes submitted in last 24h when limit was hit) → small
 *   - Otherwise → at least large
 *   - At large, 3 consecutive days without hitting limit → xl
 *   - At xl, 3 consecutive days hitting limit → back to large
 */

import type { SupabaseLogger } from "../../../api/supabaseClient";

export type FeedSize = "small" | "large" | "xl";

const DAYS_TO_ESCALATE = 3;
const DAYS_TO_DEESCALATE = 3;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function determineFeedSize(
  logger: SupabaseLogger
): Promise<{ feedSize: FeedSize; reason: string }> {
  const [feedSize, bottlenecked, daysWithout, daysWith, limitHitToday, lastCheckDate] =
    await Promise.all([
      logger.getPipelineState("feed_size"),
      logger.getPipelineState("bottlenecked"),
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

  // Bottlenecked (≤5 notes in 24h) → small
  if (bottlenecked === "true") {
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
    currentSize = "xl";
  }

  // De-escalation: at xl, 3+ days hitting limit → back to large
  if (currentSize === "xl" && daysWithHit >= DAYS_TO_DEESCALATE) {
    currentSize = "large";
  }

  await logger.setPipelineState("feed_size", currentSize);

  const parts = [`${daysWithoutHit}d without limit`, `${daysWithHit}d with limit`];
  return { feedSize: currentSize, reason: parts.join(", ") };
}

export function buildPostSelection(_feedSize: FeedSize): string {
  // Hardcoded to small — we lost access to "large" feed (403) as of 2026-03-25
  return `feed_size: small, feed_lang: en`;
}
