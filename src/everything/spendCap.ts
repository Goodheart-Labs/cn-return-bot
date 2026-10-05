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
 * Reader work has a ceiling of its own as well. Readers' pages and questions
 * stop once they have spent the request cap in a day, so the feed always keeps
 * the rest of the day's money.
 *
 * The amounts are in USD because the cost column is in USD. The default cap is
 * 50 USD a day, 10 USD of it reserved for reader requests (Jim, 2026-09-15).
 * Reader requests may spend at most 25 USD a day (Jim, 2026-10-05).
 * Set EVERYTHING_DAILY_SPEND_CAP_USD, EVERYTHING_REQUEST_RESERVE_USD and
 * EVERYTHING_REQUEST_DAILY_CAP_USD to override.
 */

import { fetchCostSinceUsd, fetchReaderCostSinceUsd } from "./db";

const DEFAULT_DAILY_SPEND_CAP_USD = 50;
const DEFAULT_REQUEST_RESERVE_USD = 10;
const DEFAULT_REQUEST_DAILY_CAP_USD = 25;

export const DAILY_SPEND_CAP_USD = Number(process.env.EVERYTHING_DAILY_SPEND_CAP_USD || DEFAULT_DAILY_SPEND_CAP_USD);

export const REQUEST_RESERVE_USD = Number(process.env.EVERYTHING_REQUEST_RESERVE_USD || DEFAULT_REQUEST_RESERVE_USD);

/** What reader-requested work may spend in a day, out of the whole cap. */
export const REQUEST_DAILY_CAP_USD = Number(process.env.EVERYTHING_REQUEST_DAILY_CAP_USD || DEFAULT_REQUEST_DAILY_CAP_USD);

/** What feed and backlog work may spend in a day: the cap minus the reserve. */
export const FEED_BUDGET_USD = DAILY_SPEND_CAP_USD - REQUEST_RESERVE_USD;

/** How long a fetched spend total stays valid. Several claim checks run at
 *  once and each takes minutes, so a short cache keeps the per-claim checks
 *  from hammering the database while staying close enough to the live total. */
const SPEND_CACHE_MS = 30_000;

/** Today's spend so far: everything, and the part spent on readers' requests. */
interface TodaySpend {
  totalUsd: number;
  readerUsd: number;
}

let cached: { spend: TodaySpend; fetchedAt: number } | null = null;

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function todaySpend(): Promise<TodaySpend> {
  if (!cached || Date.now() - cached.fetchedAt > SPEND_CACHE_MS) {
    const since = startOfUtcDay();
    const [totalUsd, readerUsd] = await Promise.all([fetchCostSinceUsd(since), fetchReaderCostSinceUsd(since)]);
    cached = { spend: { totalUsd, readerUsd }, fetchedAt: Date.now() };
  }
  return cached.spend;
}

export async function todaySpendUsd(): Promise<number> {
  return (await todaySpend()).totalUsd;
}

/** Whether feed and backlog work must stop. It stops early, at the cap minus
 *  the reserve, so the reserve is still there when a reader asks. */
export async function feedBudgetExhausted(): Promise<boolean> {
  return (await todaySpendUsd()) >= FEED_BUDGET_USD;
}

/** Whether reader-requested work must stop. It stops at the full cap, the
 *  hard ceiling of the day, or once readers alone have spent the request cap. */
export async function requestBudgetExhausted(): Promise<boolean> {
  const { totalUsd, readerUsd } = await todaySpend();
  return totalUsd >= DAILY_SPEND_CAP_USD || readerUsd >= REQUEST_DAILY_CAP_USD;
}

export async function describeTodaySpend(): Promise<string> {
  const { totalUsd, readerUsd } = await todaySpend();
  return `$${totalUsd.toFixed(2)} of the $${DAILY_SPEND_CAP_USD} daily cap, $${readerUsd.toFixed(2)} of it on reader requests ($${REQUEST_RESERVE_USD} reserved for them, at most $${REQUEST_DAILY_CAP_USD})`;
}
