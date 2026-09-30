/**
 * Shared helper for fetching every row of a query, one page at a time.
 *
 * Supabase's REST layer (PostgREST) never returns more than a fixed number of
 * rows in one response. The project's "max rows" setting decides that number,
 * and it was 1000 for a long time. A read that asks for more gets the first
 * rows and no error, so a growing table silently loses its tail. In September
 * 2026 the extension lost 400 of 1,412 pages this way. Every read that can
 * return more than a handful of rows goes through this module.
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
 *
 * The module imports nothing, so the Common Notes layers, the pipelines and the
 * dashboards can all use it.
 */

const PAGE_SIZE = 1000;
const IN_LIST_CHUNK_SIZE = 200;

type QueryResult = { data: unknown[] | null; error: { message?: string; code?: string } | null };

/** The part of a supabase-js query builder the pager calls. Callers pass the
 *  real builder, which has these methods and many more. */
type PageableQuery = PromiseLike<QueryResult> & {
  order(column: string, options: { ascending: boolean }): PageableQuery;
  limit(count: number): PageableQuery;
  gt(column: string, value: unknown): PageableQuery;
};

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
 * `.order(keyCol).limit(pageSize)`, and on every page after the first it also
 * adds `.gt(keyCol, lastSeenKey)`.
 *
 * Three rules apply, and the helper checks the last two.
 *  1. `keyCol` must be unique and indexed. In practice it is always the table's
 *     primary key. A column that is not unique can drop or repeat rows where
 *     one page ends and the next begins.
 *  2. `keyCol` must be one of the columns you select. The helper reads
 *     `data[i][keyCol]` to move the cursor forward.
 *  3. `buildQuery` must not call `.order()`. supabase-js would add the key
 *     ordering after yours, so the rows would come sorted by your column while
 *     the cursor moved by the key, and rows would be skipped or repeated. Sort
 *     the array in JavaScript after the fetch returns instead.
 *
 * The loop ends on the first empty page, not on the first short one. A page
 * can come back shorter than `pageSize` while more rows remain, whenever the
 * server's cap is below `pageSize`. The price is one extra request that
 * returns nothing.
 */
export async function fetchAllRows<T extends object>(
  buildQuery: () => unknown,
  keyCol: string,
  options: FetchAllOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const where = options.label ? `[paging:${options.label}]` : "[paging]";
  const all: T[] = [];
  let lastKey: unknown = null;

  for (let pageIdx = 0; ; pageIdx++) {
    const base = buildQuery() as PageableQuery & { url?: URL };
    if (pageIdx === 0 && base.url?.searchParams.has("order")) {
      throw new Error(`${where} buildQuery already orders its rows. Paging needs to order by "${keyCol}" alone, so sort the result in JavaScript instead.`);
    }
    let q = base.order(keyCol, { ascending: true }).limit(pageSize);
    if (lastKey !== null) q = q.gt(keyCol, lastKey);
    const { data, error } = await q;
    if (error) throw enrichError(error, where, pageIdx, keyCol, lastKey);
    if (!data || data.length === 0) break;
    const lastRow = data[data.length - 1] as Record<string, unknown>;
    // Without keyCol among the selected columns the cursor could not move, so
    // we fail loudly rather than loop or stop early.
    if (!(keyCol in lastRow)) {
      throw new Error(`${where} keyCol "${keyCol}" is missing from the selected columns. Add "${keyCol}" to your select(...).`);
    }
    all.push(...(data as T[]));
    lastKey = lastRow[keyCol];
  }

  return all;
}

function enrichError(error: { message?: string; code?: string }, where: string, pageIdx: number, keyCol: string, lastKey: unknown): Error {
  const ctx = `${where} page ${pageIdx} (${keyCol}>${lastKey ?? "<start>"})`;
  if (error.code === "57014") {
    return new Error(
      `${ctx} timed out (Postgres statement_timeout). ` +
      `The query may need an index on its filter column, or a smaller page size. Original: ${error.message}`,
    );
  }
  return new Error(`${ctx} failed: ${error.message ?? String(error)}`);
}

/**
 * Fetch every row where some column matches any value in a list.
 *
 * Supabase turns `.in()` into a URL query parameter. Past roughly 250 ids that
 * URL grows long enough to hit nginx's cap on URL length. So the list is split
 * into chunks of 200. Each chunk is read with `fetchAllRows`, because one
 * value can match many rows and a chunk can then pass the row cap on its own.
 * `keyCol` follows the same rules as there.
 */
export async function fetchInBatches<T extends object>(
  buildQuery: (chunk: string[]) => unknown,
  ids: string[],
  keyCol: string,
  options: { label?: string; chunkSize?: number } = {},
): Promise<T[]> {
  const chunkSize = options.chunkSize ?? IN_LIST_CHUNK_SIZE;
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const label = `${options.label ?? "fetchInBatches"} chunk ${i / chunkSize}`;
    out.push(...(await fetchAllRows<T>(() => buildQuery(chunk), keyCol, { label })));
  }
  return out;
}
