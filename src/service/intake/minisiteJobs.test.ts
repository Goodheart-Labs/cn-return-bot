import { expect, mock, test } from "bun:test";
import { PageReadError, type MinisitePage } from "../../everything/minisites/readPage";
import { consumeMinisiteJobs } from "./minisiteJobs";

type Row = Record<string, unknown>;

/** An in-memory stand-in for the jobs table that understands the few query
 *  shapes the consumer uses. */
function fakeDb(rows: Row[]) {
  return {
    from() {
      let update: Row | null = null;
      let limit = Infinity;
      const filters: ((row: Row) => boolean)[] = [];
      const run = () => {
        const matched = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
        if (update) for (const row of matched) Object.assign(row, update);
        return matched;
      };
      const query = {
        select: () => query,
        update(values: Row) { update = values; return query; },
        eq(field: string, value: unknown) { filters.push((row) => row[field] === value); return query; },
        lt(field: string, value: string) { filters.push((row) => typeof row[field] === "string" && (row[field] as string) < value); return query; },
        order: () => query,
        limit(count: number) { limit = count; return query; },
        maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
        then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ data: run(), error: null })); },
      };
      return query;
    },
  };
}

const page: MinisitePage = {
  title: "A title", description: "A description", byline: "An author · A site", published_at: null, image_url: null,
  content: "Some *text*.", plain_text: "Some text.", creator_feed_url: null,
};

function setup(rows: Row[], readPage: (url: string) => Promise<MinisitePage> = async () => page) {
  const wake = mock(() => {});
  return { wake, run: () => consumeMinisiteJobs(wake, { db: fakeDb(rows) as never, readPage }) };
}

test("a read_page job gets the page as its result", async () => {
  const rows: Row[] = [{ id: "j1", kind: "read_page", url: "https://example.com/post", minisite_id: null, status: "pending" }];
  const { run, wake } = setup(rows);
  await run();
  expect(rows[0]).toMatchObject({ status: "done", result: page });
  expect(rows[0]!.started_at).toBeString();
  expect(rows[0]!.finished_at).toBeString();
  expect(wake).not.toHaveBeenCalled();
});

test("a page that cannot be read records the reader's sentence, or a general one for an unexpected failure", async () => {
  const rows: Row[] = [
    { id: "j1", kind: "read_page", url: "https://example.com/blocked", minisite_id: null, status: "pending" },
    { id: "j2", kind: "read_page", url: "https://example.com/broken", minisite_id: null, status: "pending" },
  ];
  const { run } = setup(rows, async (url) => {
    if (url.endsWith("blocked")) throw new PageReadError("We could not download this page.");
    throw new Error("socket hang up");
  });
  await run();
  expect(rows.map((row) => [row.status, row.error])).toEqual([
    ["error", "We could not download this page."],
    ["error", "We could not read this page. Please try again."],
  ]);
});

test("a fact_check job is marked done and wakes the queue worker", async () => {
  const rows: Row[] = [{ id: "j1", kind: "fact_check", url: null, minisite_id: "m1", status: "pending" }];
  const { run, wake } = setup(rows);
  await run();
  expect(rows[0]).toMatchObject({ status: "done", result: null });
  expect(wake).toHaveBeenCalledTimes(1);
});

test("a job a crash left running is failed, and a recent one is left alone", async () => {
  const rows: Row[] = [
    { id: "old", kind: "read_page", url: "https://example.com/a", minisite_id: null, status: "running", started_at: new Date(Date.now() - 60 * 60_000).toISOString() },
    { id: "new", kind: "read_page", url: "https://example.com/b", minisite_id: null, status: "running", started_at: new Date().toISOString() },
  ];
  const readPage = mock(async () => page);
  await setup(rows, readPage).run();
  expect(rows.map((row) => [row.id, row.status, row.error])).toEqual([
    ["old", "error", "Reading the page was interrupted. Please try again."],
    ["new", "running", undefined],
  ]);
  expect(readPage).not.toHaveBeenCalled();
});
