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

describe.skipIf(!pglitePath)("submission queue SQL in an isolated PostgreSQL database", () => {
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
    await db.exec(await Bun.file(new URL("../../../migrations/100_signal_submission_queue.sql", import.meta.url)).text());
  });

  beforeEach(async () => {
    await db.exec("reset role; truncate public.notes, public.pipeline_state, public.note_submission_claims, public.signal_submission_queue;");
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
  async function finish(admission: SubmissionAdmission, status: string, noteId: string | null = null, reason: string | null = null) {
    if (admission.status !== "claimed") throw new Error("Expected an admitted claim");
    await db.query("select public.finish_note_submission_claim($1, $2, $3, $4)", [admission.claimId, status, noteId, reason]);
  }
  async function notes(count: number) {
    await db.query("insert into public.notes select 'note-' || i, 'existing-' || i, clock_timestamp() from generate_series(1, $1::int) i", [count]);
  }
  async function hit(count: number, minutesAgo = 0) {
    await db.query(`insert into public.pipeline_state (key, value) values
      ('limit_hit_value', $1), ('limit_hit_at', (clock_timestamp() - $2::int * interval '1 minute')::text)
      on conflict (key) do update set value = excluded.value`, [String(count), minutesAgo]);
  }
  async function queue(tweetId: string) {
    const { rows } = await db.query<{ result: { status: "queued" } | Extract<SubmissionAdmission, { status: "submission_busy" }> }>(
      "select public.queue_signal_submission($1) as result", [tweetId]);
    return rows[0]!.result;
  }
  async function cancel(tweetId: string) {
    await db.query("select public.cancel_signal_submission($1)", [tweetId]);
  }

  test("estimated capacity leaves no permanent reserve or automatic ceiling", async () => {
    await cap(10);
    await notes(10);
    await db.exec("set role service_role");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => claim(String(100 + i))));
    expect(results.every(r => r.status === "claimed")).toBe(true);
    expect(await snapshot()).toMatchObject({ cap: 10, used24h: 10, inFlight: 8, remaining: 0,
      reserve: 0, canSubmit: true, probe: false, signalQueued: 0, nextAttemptAt: null });
  });

  test("queued Signal notes have FIFO priority without reserving unused slots", async () => {
    await queue("201");
    await queue("202");
    const before = await db.query<{ queued_at: string }>("select queued_at from public.signal_submission_queue where tweet_id = '201'");
    await queue("201");
    const after = await db.query<{ queued_at: string }>("select queued_at from public.signal_submission_queue where tweet_id = '201'");
    expect(after.rows).toEqual(before.rows);
    expect((await snapshot()).signalQueued).toBe(2);
    expect(await claim("100")).toMatchObject({ status: "capacity_reserved", reason: "signal_priority" });
    expect(await claim("202", "signal")).toMatchObject({ status: "capacity_reserved", reason: "signal_priority" });
    expect(await claim("999", "signal")).toMatchObject({ status: "capacity_reserved", reason: "signal_priority" });
    const first = await claim("201", "signal");
    expect(first.status).toBe("claimed");
    expect((await claim("202", "signal")).status).toBe("capacity_reserved");
    await finish(first, "submitted", "signal-note");
    expect((await snapshot()).signalQueued).toBe(1);
    const second = await claim("202", "signal");
    await finish(second, "rejected", null, "ineligible");
    expect((await snapshot()).signalQueued).toBe(0);
    expect((await claim("100")).status).toBe("claimed");
  });

  test("cancelling a queued note releases priority and is idempotent", async () => {
    await queue("201");
    expect((await claim("100")).status).toBe("capacity_reserved");
    await cancel("201");
    await cancel("201");
    expect((await snapshot()).signalQueued).toBe(0);
    expect((await claim("100")).status).toBe("claimed");
  });

  test.each(["submitted", "uncertain", "claimed"])("queue registration removes priority for an existing %s claim", async status => {
    await queue("123");
    const admission = await claim("123", "signal");
    if (status !== "claimed") await finish(admission, status, status === "submitted" ? "accepted-note" : null);
    // Simulate local recovery with a stale priority row while quota is closed.
    await db.exec("insert into public.signal_submission_queue (tweet_id) values ('123') on conflict do nothing");
    await hit(status === "submitted" ? 1 : 0);
    expect((await snapshot()).canSubmit).toBe(false);
    expect(await queue("123")).toMatchObject({ status: "submission_busy", reason: status, capacity: { signalQueued: 0 } });
    expect((await snapshot()).signalQueued).toBe(0);
  });

  test("queue registration detects a logged note even without a settled claim", async () => {
    await db.exec("insert into public.notes values ('already-posted', '123', clock_timestamp())");
    await hit(1);
    expect(await queue("123")).toMatchObject({ status: "submission_busy", reason: "submitted" });
    expect((await snapshot()).signalQueued).toBe(0);
  });

  test("simultaneous Signal and automatic claims on the same tweet admit only one", async () => {
    await cap(10);
    const results = await Promise.all([claim("123", "signal"), claim("123", "automatic")]);
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "submission_busy")).toHaveLength(1);
    expect((await snapshot()).inFlight).toBe(1);
  });

  test("unknown capacity allows a real submission instead of locking automation", async () => {
    expect(await snapshot()).toMatchObject({ cap: null, remaining: null, canSubmit: true });
    expect(await claim("123")).toMatchObject({ status: "claimed" });
    expect(await claim("124", "signal")).toMatchObject({ status: "claimed" });
  });

  test.each([0, 1, 2, 3])("a small stored estimate (%d) does not stop automation", async (limit) => {
    await cap(limit);
    expect((await claim("123")).status).toBe("claimed");
    expect((await claim("124", "signal")).status).toBe("claimed");
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
    await queue("123");
    const admission = await claim("123", "signal");
    await finish(admission, "uncertain");
    expect(await snapshot()).toMatchObject({ used24h: 0, inFlight: 1, remaining: 9, signalQueued: 0 });
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
    await notes(10);
    await hit(10);
    expect((await claim("123")).status).toBe("capacity_reserved");
    await db.exec("update public.notes set submitted_at = clock_timestamp() - interval '25 hours' where note_id = 'note-1'");
    expect(await snapshot()).toMatchObject({ canSubmit: true, probe: false, remaining: 1 });
    const admissions = await Promise.all([claim("123"), claim("124"), claim("125")]);
    expect(admissions.filter(r => r.status === "claimed")).toHaveLength(1);
    expect(admissions.filter(r => r.status === "capacity_reserved")).toHaveLength(2);
  });

  test("a recent actual rejection stops submissions until the earlier expiry or cooldown", async () => {
    await cap(100);
    await notes(10);
    await hit(10);
    const capacity = await snapshot();
    expect(capacity).toMatchObject({ cap: 10, remaining: 0, canSubmit: false, probe: false });
    expect(Date.parse(capacity.nextAttemptAt!) - Date.now()).toBeGreaterThan(94 * 60_000);
    expect(Date.parse(capacity.nextAttemptAt!) - Date.now()).toBeLessThan(96 * 60_000);
    await db.exec("update public.notes set submitted_at = clock_timestamp() - interval '23 hours 59 minutes' where note_id = 'note-1'");
    const earlier = await snapshot();
    expect(Date.parse(earlier.nextAttemptAt!) - Date.now()).toBeGreaterThan(50_000);
    expect(Date.parse(earlier.nextAttemptAt!) - Date.now()).toBeLessThan(70_000);
    expect(await claim("123")).toMatchObject({ status: "capacity_reserved", reason: "capacity_exhausted" });
  });

  test("only one cooldown probe enters and success releases the old cap without erasing history", async () => {
    await cap(10);
    await notes(10);
    await hit(10, 96);
    const before = await db.query<{ value: string }>("select value from public.pipeline_state where key = 'limit_hit_at'");
    expect(await snapshot()).toMatchObject({ canSubmit: true, probe: true, remaining: 0 });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => claim(String(300 + i))));
    const admitted = results.find(r => r.status === "claimed")!;
    expect(results.filter(r => r.status === "claimed")).toHaveLength(1);
    expect(results.filter(r => r.status === "capacity_reserved" && r.reason === "probe_in_flight")).toHaveLength(7);
    await finish(admitted, "submitted", "probe-note");
    expect(await snapshot()).toMatchObject({ canSubmit: true, probe: false, remaining: 0, used24h: 11 });
    expect((await claim("400")).status).toBe("claimed");
    const after = await db.query<{ value: string }>("select value from public.pipeline_state where key = 'limit_hit_at'");
    expect(after.rows).toEqual(before.rows);
  });

  test("a successful probe remains proof of recovery after its note ages out", async () => {
    await cap(0);
    await hit(0, 96);
    const admitted = await claim("123");
    await finish(admitted, "submitted", "probe-note");
    await db.exec("update public.pipeline_state set value = (clock_timestamp() - interval '27 hours')::text where key = 'limit_hit_at'; update public.note_submission_claims set claimed_at = clock_timestamp() - interval '26 hours', resolved_at = clock_timestamp() - interval '25 hours'");
    expect(await snapshot()).toMatchObject({ used24h: 0, remaining: 0, canSubmit: true, probe: false });
  });

  test("an existing unresolved claim prevents a concurrent cooldown probe", async () => {
    await cap(10);
    await notes(10);
    await claim("123");
    await hit(10, 96);
    expect(await snapshot()).toMatchObject({ canSubmit: false, probe: true, inFlight: 1 });
    expect(await claim("124")).toMatchObject({ status: "capacity_reserved", reason: "probe_in_flight" });
  });

  test("daily-limit settlement atomically records actual usage and retains the approved queue", async () => {
    await cap(100);
    await notes(6);
    const unlogged = await claim("999");
    await finish(unlogged, "submitted", "accepted-unlogged");
    await queue("123");
    const admission = await claim("123", "signal");
    await db.exec("set role service_role");
    await finish(admission, "rejected", null, "X: DAILY LIMIT reached");
    expect(await snapshot()).toMatchObject({ cap: 7, used24h: 7, inFlight: 0, remaining: 0,
      canSubmit: false, probe: false, signalQueued: 1 });
    const { rows } = await db.query<{ key: string; value: string }>("select key, value from public.pipeline_state");
    const values = Object.fromEntries(rows.map(r => [r.key, r.value]));
    expect(values.writing_limit).toBe("7");
    expect(values.limit_hit_value).toBe("7");
    expect(Date.now() - Date.parse(values.limit_hit_at!)).toBeLessThan(1000);
    await finish(admission, "rejected", null, "X: DAILY LIMIT reached");
    const after = await db.query<{ value: string }>("select value from public.pipeline_state where key = 'limit_hit_at'");
    expect(after.rows[0]!.value).toBe(values.limit_hit_at!);
  });

  test("failed probe renews the cooldown, while an ineligible note does not", async () => {
    await cap(0);
    await hit(0, 96);
    await queue("123");
    const ineligible = await claim("123", "signal");
    await finish(ineligible, "rejected", null, "tweet ineligible");
    expect(await snapshot()).toMatchObject({ canSubmit: true, probe: true, signalQueued: 0 });
    await queue("124");
    const limited = await claim("124", "signal");
    await finish(limited, "rejected", null, "daily limit");
    expect(await snapshot()).toMatchObject({ canSubmit: false, probe: false, signalQueued: 1 });
  });

  test("deferring before the X call releases the claim but preserves queue priority and cooldown", async () => {
    await cap(10);
    await notes(10);
    await hit(10, 96);
    await queue("123");
    await queue("124");
    const before = await db.query("select key, value from public.pipeline_state order by key");
    const admission = await claim("123", "signal");
    expect(admission.status).toBe("claimed");
    await finish(admission, "rejected", null, "signal_submission_deferred");
    expect(await snapshot()).toMatchObject({ inFlight: 0, canSubmit: true, probe: true, signalQueued: 2 });
    const after = await db.query("select key, value from public.pipeline_state order by key");
    expect(after.rows).toEqual(before.rows);
    expect(await claim("100")).toMatchObject({ status: "capacity_reserved", reason: "signal_priority" });
    expect(await claim("124", "signal")).toMatchObject({ status: "capacity_reserved", reason: "signal_priority" });
    expect(await claim("123", "signal")).toMatchObject({ status: "claimed" });
  });

  test("reconciling an older probe does not clear a newer actual rejection", async () => {
    await cap(0);
    await hit(0, 96);
    const old = await claim("123");
    await finish(old, "uncertain");
    await hit(1);
    await finish(old, "submitted", "old-probe-note");
    expect(await snapshot()).toMatchObject({ used24h: 1, canSubmit: false, probe: false });
  });

  test.each([
    "insert into public.pipeline_state values ('writing_limit', 'NaN')",
    "insert into public.pipeline_state values ('limit_hit_value', '10'), ('limit_hit_at', 'bad date')",
    "insert into public.pipeline_state values ('limit_hit_value', '10')",
  ])("malformed state raises instead of silently allowing a request: %s", async sql => {
    await db.exec(sql);
    await expect(claim("123")).rejects.toThrow();
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.note_submission_claims");
    expect(rows[0]!.n).toBe(0);
  });

  test("RLS is enabled and only service_role has function/table access", async () => {
    const { rows } = await db.query<{ enabled: boolean }>("select relrowsecurity as enabled from pg_class where oid = 'public.note_submission_claims'::regclass");
    expect(rows[0]!.enabled).toBe(true);
    const queueTable = await db.query<{ enabled: boolean }>("select relrowsecurity as enabled from pg_class where oid = 'public.signal_submission_queue'::regclass");
    expect(queueTable.rows[0]!.enabled).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const privileges = await db.query<{ execute: boolean; settle: boolean; insert: boolean }>(`
        select has_function_privilege($1, 'public.claim_note_submission(text,text)', 'execute') as execute,
          has_function_privilege($1, 'public.finish_note_submission_claim(uuid,text,text,text)', 'execute') as settle,
          has_table_privilege($1, 'public.note_submission_claims', 'insert') as insert`, [role]);
      expect(privileges.rows[0]).toEqual({ execute: false, settle: false, insert: false });
      await db.exec(`set role ${role}`);
      await expect(claim("123", "signal")).rejects.toThrow("permission denied");
      await expect(snapshot()).rejects.toThrow("permission denied");
      await expect(queue("123")).rejects.toThrow("permission denied");
      await expect(cancel("123")).rejects.toThrow("permission denied");
      await db.exec("reset role");
    }
    await cap(10);
    await db.exec("set role service_role");
    await queue("123");
    await cancel("123");
    await queue("123");
    const admitted = await claim("123", "signal");
    await finish(admitted, "submitted", "note");
    expect((await snapshot()).used24h).toBe(1);
  });
});
