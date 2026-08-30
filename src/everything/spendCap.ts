/**
 * Daily spend cap for the everything pipeline. Every claim check records its
 * LLM cost in everything_pipeline_runs, and this module sums today's costs
 * before more money is spent. Once the cap is reached the pipeline stops
 * processing for the rest of the UTC day. Consuming requests and enqueueing
 * items stays allowed, because those steps cost nothing.
 *
 * The cap is set in USD because the cost column is in USD. The default is
 * about 50 EUR. Set EVERYTHING_DAILY_SPEND_CAP_USD to override it.
 */

import { fetchCostSinceUsd } from "./db";

const DEFAULT_DAILY_SPEND_CAP_USD = 55;

export const DAILY_SPEND_CAP_USD = Number(process.env.EVERYTHING_DAILY_SPEND_CAP_USD || DEFAULT_DAILY_SPEND_CAP_USD);

/** How long a fetched spend total stays valid. Claim checks run four at a time
 *  and each takes minutes, so a short cache keeps the per-claim checks from
 *  hammering the database while staying close enough to the live total. */
const SPEND_CACHE_MS = 30_000;

let cached: { spentUsd: number; fetchedAt: number } | null = null;

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function todaySpendUsd(): Promise<number> {
  if (!cached || Date.now() - cached.fetchedAt > SPEND_CACHE_MS) {
    cached = { spentUsd: await fetchCostSinceUsd(startOfUtcDay()), fetchedAt: Date.now() };
  }
  return cached.spentUsd;
}

export async function spendCapReached(): Promise<boolean> {
  return (await todaySpendUsd()) >= DAILY_SPEND_CAP_USD;
}

export function describeSpend(spentUsd: number): string {
  return `$${spentUsd.toFixed(2)} of the $${DAILY_SPEND_CAP_USD} daily cap`;
}
