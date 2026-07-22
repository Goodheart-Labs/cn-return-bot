/**
 * Shared keyset-paginated fetch helper.
 *
 * Supabase's REST layer caps any single response at 1000 rows, so to fetch
 * "everything matching X" we have to make multiple HTTP requests. This module
 * is the single source of truth for that loop.
 *
 * Why keyset and not OFFSET: OFFSET pagination forces Postgres to walk past
 * every skipped row even with an index, so per-page cost grows linearly with
 * page depth. Past ~30k matching rows the deepest pages exceed Postgres's
 * statement_timeout (`canceling statement due to statement timeout`, code
 * 57014). Keyset pagination uses `WHERE keyCol > <last>` ORDER BY keyCol —
 * an index range scan from the last row, ~constant time per page regardless
 * of depth.
 *
 * Cost: callers must pass a unique, indexed `keyCol`. In practice this is
 * always the table's primary key (every Postgres table has one, and PKs are
 * indexed by definition).
 */

const PAGE_SIZE = 1000;

export interface FetchAllOptions {
  /** Used in error messages; helps locate the failing call site. */
  label?: string;
  /** Override the default 1000-row page size. Rarely needed. */
  pageSize?: number;
}

/**
 * Fetch every row matching `buildQuery()`, paginated by `keyCol` ascending.
 *
 * `buildQuery` is invoked once per page so the caller's filters / select
 * shape get reused. The helper appends `.order(keyCol).limit(PAGE_SIZE)` and,
 * on subsequent pages, `.gt(keyCol, lastSeenKey)`.
 *
 * Gotchas:
 *  1. `keyCol` must be UNIQUE and INDEXED (in practice: always the table's PK).
 *     Non-unique columns can drop or duplicate rows at page boundaries.
 *  2. `keyCol` must appear in your `select(...)` columns — the helper reads
 *     `data[i][keyCol]` to advance the cursor.
 *  3. Any `.order()` your buildQuery sets is OVERRIDDEN by the keyset's
 *     `.order(keyCol, ascending)`. If you need a different sort order in the
 *     final result, sort the array in JS after the fetch returns.
 */
export async function fetchAllRows<T extends Record<string, any>>(
  buildQuery: () => any,
  keyCol: string,
  options: FetchAllOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const all: T[] = [];
  let lastKey: any = null;
  let pageIdx = 0;

  while (true) {
    let q = buildQuery().order(keyCol, { ascending: true }).limit(pageSize);
    if (lastKey !== null) q = q.gt(keyCol, lastKey);
    const { data, error } = await q;
    if (error) throw enrichError(error, options.label, pageIdx, keyCol, lastKey);
    if (!data || data.length === 0) break;
    // Guard the silent-truncation footgun (gotcha #2): if keyCol isn't in the
    // selected columns, the cursor reads `undefined` and pagination stops after
    // one page — quietly capping at pageSize. Turn that into a loud error.
    if (pageIdx === 0 && !(keyCol in data[0])) {
      const where = options.label ? `[paging:${options.label}]` : "[paging]";
      throw new Error(
        `${where} keyCol "${keyCol}" is missing from the selected columns, so keyset pagination ` +
        `would silently truncate at ${pageSize} rows. Add "${keyCol}" to your select(...).`,
      );
    }
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    lastKey = data[data.length - 1][keyCol];
    pageIdx++;
  }

  return all;
}

function enrichError(error: any, label: string | undefined, pageIdx: number, keyCol: string, lastKey: any): Error {
  const where = label ? `[paging:${label}]` : "[paging]";
  const ctx = `${where} page ${pageIdx} (${keyCol}>${lastKey ?? "<start>"})`;
  if (error.code === "57014") {
    return new Error(
      `${ctx} timed out (Postgres statement_timeout). ` +
      `Even keyset pagination hit the wall — the underlying query may need an index on its filter column, ` +
      `or the page size may be too large for this query's per-row cost. Original: ${error.message}`,
    );
  }
  return new Error(`${ctx} failed: ${error.message ?? String(error)}`);
}

/**
 * Batch-IN fetcher: fetch rows where some column is IN a list of values.
 * Supabase generates a URL query param for `.in()`, which gets too long past
 * ~250 ids and starts hitting nginx URL-length caps. Chunks the list into
 * groups of 200.
 */
export async function fetchInBatches<T>(
  buildQuery: (chunk: string[]) => any,
  ids: string[],
  options: { label?: string; chunkSize?: number } = {},
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunkSize = options.chunkSize ?? 200;
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await buildQuery(chunk);
    if (error) {
      const where = options.label ? `[paging:${options.label}]` : "[paging:fetchInBatches]";
      throw new Error(`${where} chunk ${i / chunkSize} failed: ${error.message ?? String(error)}`);
    }
    if (data) out.push(...(data as T[]));
  }
  return out;
}
