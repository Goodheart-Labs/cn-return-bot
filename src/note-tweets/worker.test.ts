import { expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TypefullyDraftState } from "../everything-core/xMarks";
import { handleRequest, handleRequests, syncScheduled, type WorkerDeps } from "./worker";

type Row = Record<string, unknown>;

/** Just enough of supabase-js's query builder, over tables in memory, for
 *  the calls the worker makes. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: ((row: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "update"; fields: Row } | { kind: "delete" } | { kind: "upsert"; row: Row } = { kind: "select" };
    let single = false;
    let limit = Infinity;
    const run = () => {
      const hit = rows.filter((row) => filters.every((f) => f(row)));
      if (op.kind === "update") for (const row of hit) Object.assign(row, op.fields);
      if (op.kind === "delete") for (const row of hit) rows.splice(rows.indexOf(row), 1);
      if (op.kind === "upsert") {
        const row = op.row;
        const old = rows.find((r) => r.note_id === row.note_id);
        if (old) Object.assign(old, row);
        else rows.push({ ...row });
      }
      const data = hit.slice(0, limit).map((row) => ({ ...row }));
      return { data: single ? (data[0] ?? null) : data, error: null };
    };
    const builder = {
      select: () => builder,
      update: (fields: Row) => ((op = { kind: "update", fields }), builder),
      delete: () => ((op = { kind: "delete" }), builder),
      upsert: (row: Row) => ((op = { kind: "upsert", row }), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      match: (values: Row) => (filters.push((row) => Object.entries(values).every(([k, v]) => row[k] === v)), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: () => ((single = true), builder),
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => resolve(run()),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const NOTE = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-11-08T12:00:00Z");

function setup(tables: Record<string, Row[]>, draft: WorkerDeps["draft"] = async () => ({ draftId: "d1", scheduledFor: "2026-11-08T15:00:00Z" })) {
  const drafts: Parameters<WorkerDeps["draft"]>[0][] = [];
  const deps: WorkerDeps = {
    db: fakeDb(tables),
    image: async () => new ArrayBuffer(4),
    draft: async (d) => (drafts.push(d), draft(d)),
    states: async () => ({}),
    now: () => NOW,
  };
  return { deps, drafts, tables };
}

const request = (fields: Row = {}): Row => ({
  id: "r1",
  note_id: NOTE,
  tweet_text: "A note",
  reply_text: "Get the extension",
  requested_by: "nathan",
  requested_at: "2026-11-08T11:59:00Z",
  status: "pending",
  ...fields,
});

test("a pending request becomes a draft in the next free slot and a scheduled note", async () => {
  const { deps, drafts, tables } = setup({ everything_x_post_requests: [request()], everything_note_x_marks: [] });
  await handleRequests(deps);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({ text: "A note", reply: "Get the extension", timing: "next_free_slot" });
  expect(tables.everything_note_x_marks).toEqual([
    expect.objectContaining({ note_id: NOTE, mark: "scheduled", typefully_draft_id: "d1", scheduled_for: "2026-11-08T15:00:00Z", marked_by: "nathan" }),
  ]);
  expect(tables.everything_x_post_requests![0]).toMatchObject({ status: "sent", typefully_draft_id: "d1" });
});

test("a note already scheduled or posted gets no second draft", async () => {
  const { deps, drafts, tables } = setup({ everything_x_post_requests: [request()], everything_note_x_marks: [{ note_id: NOTE, mark: "posted" }] });
  await handleRequests(deps);
  expect(drafts).toHaveLength(0);
  expect(tables.everything_x_post_requests![0]).toMatchObject({ status: "failed" });
});

test("a request another worker took, or an old one, is never sent", async () => {
  const taken = request({ status: "sending" });
  const { deps, drafts } = setup({ everything_x_post_requests: [taken, request({ id: "r2", requested_at: "2026-11-06T00:00:00Z" })] });
  // Read as pending a moment ago, but claimed by another worker since.
  await handleRequest(deps, { ...taken, status: "pending" } as unknown as Parameters<typeof handleRequest>[1]);
  await handleRequests(deps);
  expect(drafts).toHaveLength(0);
});

test("a failed send leaves the note unmarked and says why", async () => {
  const { deps, tables } = setup({ everything_x_post_requests: [request()], everything_note_x_marks: [] }, async () => {
    throw new Error("Typefully draft answered 401");
  });
  await handleRequests(deps);
  expect(tables.everything_note_x_marks).toEqual([]);
  expect(tables.everything_x_post_requests![0]).toMatchObject({ status: "failed", error: "Typefully draft answered 401" });
});

test("the sync follows Typefully, but never overrides a mark an admin changed", async () => {
  const marks: Row[] = [
    { note_id: "a", mark: "scheduled", typefully_draft_id: "da", scheduled_for: null },
    { note_id: "b", mark: "scheduled", typefully_draft_id: "db", scheduled_for: null },
    { note_id: "c", mark: "wont_post", typefully_draft_id: "dc", scheduled_for: null },
  ];
  const { deps, tables } = setup({ everything_note_x_marks: marks });
  const states: Record<string, TypefullyDraftState> = {
    da: { state: "deleted" },
    db: { state: "published", publishedAt: "2026-11-08T13:00:00Z", tweetUrl: "https://x.com/NathanpmYoung/status/1" },
    dc: { state: "deleted" },
  };
  deps.states = async () => states;
  await syncScheduled(deps);
  expect(tables.everything_note_x_marks!.map((m) => [m.note_id, m.mark, m.tweet_url ?? null])).toEqual([
    ["b", "posted", "https://x.com/NathanpmYoung/status/1"],
    ["c", "wont_post", null],
  ]);
});
