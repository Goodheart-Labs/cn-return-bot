/**
 * Optional PostgreSQL integration tests with an in-memory PGlite installation.
 * No application credentials, remote database or repository dependency needed:
 * CN_RESERVE_TEST_PGLITE_PATH=/tmp/dbtest/node_modules/@electric-sql/pglite/dist/index.js \
 *   bun test src/pipeline/capacity/submissionReserve.sql.test.ts
 * PGlite serializes queries; Promise.all tests competing callers, while the
 * migration's advisory lock additionally serializes separate production backends.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SubmissionAdmission, SubmissionCapacity } from "./submissionReserve";

interface TestDatabase {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

const pglitePath = process.env.CN_RESERVE_TEST_PGLITE_PATH;

describe.skipIf(!pglitePath)("submission reserve SQL in an isolated PostgreSQL database", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    const { PGlite } = await import(pglitePath!);
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.notes (note_id text primary key, tweet_id text not null, submitted_at timestamptz);
      create table public.pipeline_state (key text primary key, value text not null);
      grant usage on schema public to anon, authenticated, service_role;
      grant select on public.notes, public.pipeline_state to service_role;
    `);
    await db.exec(await Bun.file(new URL("../../../migrations/093_signal_submission_reserve.sql", import.meta.url)).text());
  });

  beforeEach(async () => {
    await db.exec("reset role; truncate public.notes, public.pipeline_state, public.note_submission_claims;");
  });

  afterAll(async () => { await db?.close(); });

  async function cap(value: number) {
    await db.query("insert into public.pipeline_state (key, value) values ('writing_limit', $1) on conflict (key) do update set value = excluded.value", [String(value)]);
  }
  async function claim(tweetId: string, lane = "automatic") {
    const { rows } = await db.query<{ result: SubmissionAdmission }>("select public.claim_note_submission($1, $2) as result", [tweetId, lane]);
    return rows[0]!.result;
  }
  async function snapshot() {
    const { rows } = await db.query<{ result: SubmissionCapacity }>("select public.get_note_submission_capacity() as result");
    return rows[0]!.result;
  }
  async function finish(admission: SubmissionAdmission, status: string, noteId: string | null = null) {
    if (admission.status !== "claimed") throw new Error("Expected an admitted claim");
    await db.query("select public.finish_note_submission_claim($1, $2, $3, null)", [admission.claimId, status, noteId]);
  }
  async function notes(count: number) {
    await db.query("insert into public.notes select 'note-' || i, 'existing-' || i, clock_timestamp() from generate_series(1, $1::int) i", [count]);
  }

  test("competing automatic callers cannot consume the final three slots; Signal can", async () => {
    await cap(10);
    await notes(6);
    await db.exec("set role service_role");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => claim(String(100 + i))));
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "capacity_reserved")).toHaveLength(7);
    expect(await snapshot()).toMatchObject({ cap: 10, used24h: 6, inFlight: 1, remaining: 3 });
    const signals = await Promise.all(Array.from({ length: 4 }, (_, i) => claim(String(200 + i), "signal")));
    expect(signals.filter((r) => r.status === "claimed")).toHaveLength(3);
    expect(signals[3]).toMatchObject({ status: "capacity_reserved", reason: "capacity_exhausted" });
  });

  test("simultaneous Signal and automatic claims on the same tweet admit only one", async () => {
    await cap(10);
    const results = await Promise.all([claim("123", "signal"), claim("123", "automatic")]);
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "submission_busy")).toHaveLength(1);
    expect((await snapshot()).inFlight).toBe(1);
  });

  test("unknown capacity blocks automation but Signal can establish an observation", async () => {
    expect(await claim("123")).toMatchObject({ status: "capacity_reserved", reason: "unknown_capacity" });
    expect(await claim("124", "signal")).toMatchObject({ status: "claimed" });
  });

  test.each([0, 1, 2, 3])("a small known cap (%d) cannot be spent by automation", async (limit) => {
    await cap(limit);
    expect((await claim("123")).status).toBe("capacity_reserved");
    expect((await claim("124", "signal")).status).toBe(limit === 0 ? "capacity_reserved" : "claimed");
  });

  test("accepted claims count when notes logging fails and never count twice after it succeeds", async () => {
    await cap(10);
    const admission = await claim("123");
    await finish(admission, "submitted", "new-note");
    expect(await snapshot()).toMatchObject({ used24h: 1, inFlight: 0, remaining: 9 });
    await db.exec("insert into public.notes values ('new-note', '123', clock_timestamp())");
    expect(await snapshot()).toMatchObject({ used24h: 1, inFlight: 0, remaining: 9 });
    expect(await claim("123", "signal")).toMatchObject({ status: "submission_busy", reason: "submitted" });
  });

  test("a failed claim settlement is deduplicated by the successfully logged tweet", async () => {
    await cap(10);
    await claim("123");
    // Worker clocks may lag the database clock; no cross-clock ordering is safe.
    await db.exec("insert into public.notes values ('new-note', '123', clock_timestamp() - interval '5 minutes')");
    expect(await snapshot()).toMatchObject({ used24h: 1, inFlight: 0, remaining: 9 });
  });

  test("uncertain claims reserve capacity for 24h but permanently prevent same-tweet retries", async () => {
    await cap(10);
    const admission = await claim("123");
    await finish(admission, "uncertain");
    expect(await snapshot()).toMatchObject({ used24h: 0, inFlight: 1, remaining: 9 });
    expect(await claim("123", "signal")).toMatchObject({ status: "submission_busy", reason: "uncertain" });
    await db.exec("update public.note_submission_claims set resolved_at = clock_timestamp() - interval '25 hours'");
    expect((await snapshot()).inFlight).toBe(0);
    expect((await claim("123", "signal")).status).toBe("submission_busy");
  });

  test("abandoned in-flight claims do not expire into a retry or free capacity", async () => {
    await cap(10);
    await claim("123");
    await db.exec("update public.note_submission_claims set claimed_at = clock_timestamp() - interval '25 hours'");
    expect((await snapshot()).inFlight).toBe(1);
    expect((await claim("123", "signal")).status).toBe("submission_busy");
  });

  test("definite rejection releases capacity while settled acceptance cannot be undone", async () => {
    await cap(10);
    const rejected = await claim("123");
    await finish(rejected, "rejected");
    expect((await snapshot()).inFlight).toBe(0);
    const accepted = await claim("123", "signal");
    await finish(accepted, "submitted", "note");
    await finish(accepted, "submitted", "note"); // idempotent
    await expect(finish(accepted, "rejected")).rejects.toThrow("already settled");
  });

  test("old submissions age out and restore automatic headroom", async () => {
    await cap(10);
    await notes(7);
    expect((await claim("123")).status).toBe("capacity_reserved");
    await db.exec("update public.notes set submitted_at = clock_timestamp() - interval '25 hours' where note_id = 'note-1'");
    expect((await claim("123")).status).toBe("claimed");
  });

  test("a recent X rejection takes precedence over the speculative count-plus-one estimate", async () => {
    await cap(11);
    await notes(7);
    await db.exec("insert into public.pipeline_state values ('limit_hit_value', '10'), ('limit_hit_at', clock_timestamp()::text)");
    expect(await claim("123")).toMatchObject({ status: "capacity_reserved", capacity: { cap: 10, remaining: 3 } });
  });

  test("malformed stored state does not open automatic capacity", async () => {
    await db.exec("insert into public.pipeline_state values ('writing_limit', 'NaN'), ('limit_hit_value', '10'), ('limit_hit_at', 'bad date')");
    expect(await claim("123")).toMatchObject({ status: "capacity_reserved", reason: "unknown_capacity" });
  });

  test("RLS is enabled and only service_role has function/table access", async () => {
    const { rows } = await db.query<{ enabled: boolean }>("select relrowsecurity as enabled from pg_class where oid = 'public.note_submission_claims'::regclass");
    expect(rows[0]!.enabled).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const privileges = await db.query<{ execute: boolean; settle: boolean; insert: boolean }>(`
        select has_function_privilege($1, 'public.claim_note_submission(text,text)', 'execute') as execute,
          has_function_privilege($1, 'public.finish_note_submission_claim(uuid,text,text,text)', 'execute') as settle,
          has_table_privilege($1, 'public.note_submission_claims', 'insert') as insert`, [role]);
      expect(privileges.rows[0]).toEqual({ execute: false, settle: false, insert: false });
      await db.exec(`set role ${role}`);
      await expect(claim("123", "signal")).rejects.toThrow("permission denied");
      await expect(snapshot()).rejects.toThrow("permission denied");
      await db.exec("reset role");
    }
    await cap(10);
    await db.exec("set role service_role");
    const admitted = await claim("123");
    await finish(admitted, "submitted", "note");
    expect((await snapshot()).used24h).toBe(1);
  });
});
