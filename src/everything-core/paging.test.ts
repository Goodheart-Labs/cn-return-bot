import { describe, expect, test } from "bun:test";
import { fetchAllRows, fetchInBatches } from "./paging";

type Row = { id: number; tag: string };

/** A stand-in for a supabase-js query builder over `rows`. The server returns
 *  at most `serverCap` rows per request, like PostgREST's max-rows setting. */
function fakeTable(rows: Row[], serverCap: number) {
  let requests = 0;
  const build = (inList?: string[]) => {
    const url = new URL("http://db/rest/v1/table");
    let after = -Infinity;
    let limit = Infinity;
    const query = {
      url,
      order(column: string) { url.searchParams.set("order", `${column}.asc`); return query; },
      limit(count: number) { limit = count; return query; },
      gt(_column: string, value: number) { after = value; return query; },
      then(resolve: (result: { data: Row[]; error: null }) => void) {
        requests++;
        const matching = rows.filter((r) => r.id > after && (!inList || inList.includes(r.tag)));
        resolve({ data: matching.slice(0, Math.min(limit, serverCap)), error: null });
      },
    };
    return query;
  };
  return { build, requests: () => requests };
}

const rowsUpTo = (n: number, tag = (i: number) => `t${i % 3}`) => Array.from({ length: n }, (_, i) => ({ id: i + 1, tag: tag(i) }));

describe("fetchAllRows", () => {
  test("reads every row when the server caps pages below the page size", async () => {
    const table = fakeTable(rowsUpTo(2500), 700);
    const rows = await fetchAllRows<Row>(() => table.build(), "id");
    expect(rows.map((r) => r.id)).toEqual(rowsUpTo(2500).map((r) => r.id));
  });

  test("stops on the first empty page", async () => {
    const table = fakeTable(rowsUpTo(10), 1000);
    await fetchAllRows<Row>(() => table.build(), "id");
    expect(table.requests()).toBe(2);
  });

  test("refuses a query that already has an order", async () => {
    const table = fakeTable(rowsUpTo(3), 1000);
    await expect(fetchAllRows<Row>(() => table.build().order("tag"), "id")).rejects.toThrow("already orders");
  });

  test("refuses a key column that is not selected", async () => {
    const table = fakeTable(rowsUpTo(3), 1000);
    await expect(fetchAllRows<Row>(() => table.build(), "missing")).rejects.toThrow("missing from the selected columns");
  });
});

describe("fetchInBatches", () => {
  test("pages inside a chunk whose values match more rows than the cap", async () => {
    const table = fakeTable(rowsUpTo(3000, () => "same"), 1000);
    const rows = await fetchInBatches<Row>((chunk) => table.build(chunk), ["same", "other"], "id", { chunkSize: 1 });
    expect(rows).toHaveLength(3000);
  });
});
