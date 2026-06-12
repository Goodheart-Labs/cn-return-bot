import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;
// How many requests we let fly at once. Supabase/PostgREST handles this happily
// and it turns ~20 serial round trips into ~3 waves.
const CONCURRENCY = 8;

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Serial pagination. Kept for callers that pass a pre-built query (dataset
 * runs). For large production tables prefer `fetchAllRowsParallel`, which
 * fetches pages concurrently.
 */
export async function fetchAllRows<T>(query: any, label?: string): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[supabasePaging] fetchAllRows failed${label ? ` (${label})` : ""}:`, error);
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  if (label) console.log(`[supabasePaging] ${label}: ${all.length} rows`);
  return all;
}

/**
 * Parallel pagination. `makeQuery` must return a FRESH query each call (so the
 * concurrent `.range()` calls don't race on a shared builder) and must impose a
 * stable ORDER BY so page ranges partition the same ordered set. Pages are
 * fetched in windows of CONCURRENCY until a short page marks the end.
 */
export async function fetchAllRowsParallel<T>(
  makeQuery: () => any,
  label?: string,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let done = false;
  while (!done) {
    const ranges: Array<[number, number]> = [];
    for (let k = 0; k < CONCURRENCY; k++) {
      ranges.push([offset, offset + PAGE - 1]);
      offset += PAGE;
    }
    const pages = await Promise.all(
      ranges.map(([from, to]) => makeQuery().range(from, to)),
    );
    for (const { data, error } of pages) {
      if (error) {
        console.error(`[supabasePaging] fetchAllRowsParallel failed${label ? ` (${label})` : ""}:`, error);
        throw error;
      }
      if (data && data.length) all.push(...(data as T[]));
      if (!data || data.length < PAGE) done = true;
    }
  }
  if (label) console.log(`[supabasePaging] ${label}: ${all.length} rows`);
  return all;
}

const ID_BATCH = 200;

export async function fetchInBatches<T>(
  client: SupabaseClient,
  table: string,
  select: string,
  filterCol: string,
  ids: string[],
  extraFilters?: (q: any) => any,
  label?: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    batches.push(ids.slice(i, i + ID_BATCH));
  }
  const perBatch = await mapWithConcurrency(batches, CONCURRENCY, async (batch) => {
    let q = client.from(table).select(select).in(filterCol, batch);
    if (extraFilters) q = extraFilters(q);
    const { data, error } = await q;
    if (error) {
      console.error(`[supabasePaging] fetchInBatches failed${label ? ` (${label})` : ""}:`, error);
      throw error;
    }
    return (data ?? []) as T[];
  });
  const results = perBatch.flat();
  if (label) console.log(`[supabasePaging] ${label}: ${results.length} rows`);
  return results;
}
