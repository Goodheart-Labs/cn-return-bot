/**
 * Shared helper for fetching every row of a query, one page at a time.
 *
 * Supabase's REST layer never returns more than 1000 rows in one response. To
 * fetch everything that matches a filter we therefore have to make several HTTP
 * requests. This module is the one place that loop lives.
 *
 * We page by key rather than by OFFSET. With OFFSET, Postgres still has to walk
 * past every skipped row even when there is an index, so each page costs more
 * than the one before it. Past roughly 30k matching rows the deepest pages run
 * into Postgres's statement_timeout and fail with `canceling statement due to
 * statement timeout`, error code 57014. Keyset paging instead asks for
 * `WHERE keyCol > <last value>` and orders by that column. That is an index
 * range scan starting at the last row we saw, so every page costs about the
 * same however deep it is.
 *
 * The price is that the caller has to pass a `keyCol` that is unique and
 * indexed. In practice that is always the table's primary key. Every Postgres
 * table has one, and primary keys are indexed by definition.
 */

const PAGE_SIZE = 1000;

export interface FetchAllOptions {
  /** Shown in error messages so you can tell which call site failed. */
  label?: string;
  /** Override the default 1000-row page size. Rarely needed. */
  pageSize?: number;
}

/**
 * Fetch every row that `buildQuery()` matches, paging by `keyCol` in ascending
 * order.
 *
 * The helper calls `buildQuery` once per page, so the caller's filters and
 * selected columns are reused for every request. It then adds
 * `.order(keyCol).limit(PAGE_SIZE)`, and on every page after the first it also
 * adds `.gt(keyCol, lastSeenKey)`.
 *
 * Three things can catch you out.
 *  1. `keyCol` must be unique and indexed. In practice it is always the table's
 *     primary key. A column that is not unique can drop or repeat rows where
 *     one page ends and the next begins.
 *  2. `keyCol` must be one of the columns you select. The helper reads
 *     `data[i][keyCol]` to move the cursor forward.
 *  3. Any `.order()` your `buildQuery` sets is overridden by the ordering on
 *     `keyCol`. If you need the final result in a different order, sort the
 *     array in JavaScript after the fetch returns.
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
    // This guards the second gotcha above. If keyCol is not among the selected
    // columns, the cursor reads `undefined` and the loop stops after one page.
    // That would quietly cap the result at pageSize rows, so we fail loudly
    // instead.
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
 * Fetch rows where some column matches any value in a list.
 *
 * Supabase turns `.in()` into a URL query parameter. Past roughly 250 ids that
 * URL grows long enough to hit nginx's cap on URL length. So the list is split
 * into chunks of 200 and each chunk is fetched with its own request.
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
