import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

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

const ID_BATCH = 200;
// How many batch requests to run concurrently. Loading ALL notes (~6k) means
// ~30 batches per satellite table; running them serially is ~30 round-trips of
// latency. Fire them in waves so the whole load is a handful of round-trips.
const BATCH_CONCURRENCY = 8;

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
  for (let i = 0; i < ids.length; i += ID_BATCH) batches.push(ids.slice(i, i + ID_BATCH));

  const results: T[] = [];
  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const pages = await Promise.all(
      wave.map(async (batch) => {
        let q = client.from(table).select(select).in(filterCol, batch);
        if (extraFilters) q = extraFilters(q);
        return (await q) as { data: T[] | null; error: any };
      }),
    );
    for (const { data, error } of pages) {
      if (error) {
        console.error(`[supabasePaging] fetchInBatches failed${label ? ` (${label})` : ""}:`, error);
        throw error;
      }
      if (data) results.push(...data);
    }
  }
  if (label) console.log(`[supabasePaging] ${label}: ${results.length} rows`);
  return results;
}
