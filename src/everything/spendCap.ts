/**
 * Daily spend budget for the everything pipeline. Every claim check and every
 * claim extraction records its LLM cost in everything_pipeline_runs, and this
 * module sums today's costs before more money is spent. Once a budget is
 * reached, that kind of work stops for the rest of the UTC day. Consuming
 * requests and enqueueing items stays allowed, because those steps cost
 * nothing.
 *
 * The budget is split so a reader is never turned away by backlog spending.
 * Feed and backlog work stops at the cap minus a reserve, and the reserve is
 * spendable only on pages readers asked for. A reader can still hit the wall,
 * but only after the day was genuinely spent on readers, and the extension
 * then says so instead of spinning.
 *
 * The amounts are in USD because the cost column is in USD. The default cap is
 * about 50 EUR. Set EVERYTHING_DAILY_SPEND_CAP_USD and
 * EVERYTHING_REQUEST_RESERVE_USD to override.
 */

import { fetchCostSinceUsd } from "./db";

const DEFAULT_DAILY_SPEND_CAP_USD = 55;
const DEFAULT_REQUEST_RESERVE_USD = 10;

export const DAILY_SPEND_CAP_USD = Number(process.env.EVERYTHING_DAILY_SPEND_CAP_USD || DEFAULT_DAILY_SPEND_CAP_USD);

export const REQUEST_RESERVE_USD = Number(process.env.EVERYTHING_REQUEST_RESERVE_USD || DEFAULT_REQUEST_RESERVE_USD);

/** How long a fetched spend total stays valid. Several claim checks run at
 *  once and each takes minutes, so a short cache keeps the per-claim checks
 *  from hammering the database while staying close enough to the live total. */
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

/** Whether feed and backlog work must stop. It stops early, at the cap minus
 *  the reserve, so the reserve is still there when a reader asks. */
export async function feedBudgetExhausted(): Promise<boolean> {
  return (await todaySpendUsd()) >= DAILY_SPEND_CAP_USD - REQUEST_RESERVE_USD;
}

/** Whether even reader-requested work must stop. This is the full cap, the
 *  hard ceiling of the day. */
export async function requestBudgetExhausted(): Promise<boolean> {
  return (await todaySpendUsd()) >= DAILY_SPEND_CAP_USD;
}

export function describeSpend(spentUsd: number): string {
  return `$${spentUsd.toFixed(2)} of the $${DAILY_SPEND_CAP_USD} daily cap ($${REQUEST_RESERVE_USD} of it reserved for reader requests)`;
}
