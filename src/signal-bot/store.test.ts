import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { SignalStore } from "./store";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function statePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "signal-store-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "state.sqlite");
}
function open(path: string, scope = "account/group/database/live"): SignalStore {
  const store = new SignalStore(path, scope);
  cleanups.push(() => store.close());
  return store;
}

describe("Signal durable store", () => {
  test("bot output suppression survives reopening without treating normal approval commands as outputs", () => {
    const path = statePath();
    const original = new SignalStore(path, "self-account");
    original.recordBotOutput("#1 · 12345\nProposed note · v1\nA correction.\nReply ‘yes post’.");
    original.close();
    const reopened = open(path, "self-account");
    expect(reopened.isBotOutput("#1 · 12345\nProposed note · v1\nA correction.\nReply ‘yes post’.")).toBe(true);
    expect(reopened.isBotOutput("yes post")).toBe(false);
  });
  test("conversation state, dedupe, and draft references survive reopening", () => {
    const path = statePath();
    const first = new SignalStore(path, "test");
    const conversation = first.forTweet("12345");
    conversation.draft = { text: "The source dates this to 2020.", sources: ["https://example.com/archive"], version: 2, shownAt: 1_800_000_000_000 };
    conversation.nextVersion = 3;
    first.save(conversation);
    first.reference("1800000000000", conversation.id, 2, true);
    expect(first.claimMessage("sender:1800000000010")).toBe(true);
    first.close();
    const second = open(path, "test");
    expect(second.forTweet("12345")).toEqual(conversation);
    expect(second.all()).toHaveLength(1);
    expect(second.claimMessage("sender:1800000000010")).toBe(false);
    expect(second.resolve("1800000000000")).toEqual({ conversationId: conversation.id, version: 2, showsDraft: true });
  });

  test("scope prevents sharing state across accounts, groups, databases, or run modes", () => {
    const path = statePath();
    const original = open(path);
    original.forTweet("12345");
    for (const scope of ["other-account/group/database/live", "account/other-group/database/live", "account/group/other-database/live", "account/group/database/dry"]) {
      expect(() => new SignalStore(path, scope)).toThrow("different account, group, database, or run mode");
    }
    expect(original.all()).toHaveLength(1);
  });

  test("claims are shared by independent connections and timestamp collisions do not route across tweets", () => {
    const path = statePath();
    const first = open(path);
    const second = open(path);
    expect(first.claimMessage("human:1000")).toBe(true);
    expect(second.claimMessage("human:1000")).toBe(false);
    expect(second.claimMessage("other-human:1000")).toBe(true);
    const a = first.forTweet("12345");
    const b = second.forTweet("67890");
    first.reference("1000", a.id, 1, true);
    second.reference("1000", b.id, 1, true);
    expect(first.resolve("1000")).toBeUndefined();
    expect(second.resolve("unknown")).toBeUndefined();
  });

  test("a live worker excludes a second worker, and graceful close releases ownership", () => {
    const path = statePath();
    const first = new SignalStore(path, "test");
    first.acquireWorker();
    const second = open(path, "test");
    expect(() => second.acquireWorker()).toThrow("already owns");
    first.close();
    expect(() => second.acquireWorker()).not.toThrow();
  });

  test("a restarted container can reclaim a reused PID without displacing a live worker", () => {
    const path = statePath();
    const store = open(path, "container");
    const draft = store.forTweet("12345");
    draft.status = "submitting";
    store.save(draft);
    const db = new Database(path);
    db.query("INSERT INTO metadata (key, value) VALUES ('worker', ?)").run(JSON.stringify({
      pid: process.pid, host: hostname(), token: "old-worker", processIdentity: "boot:old-start",
    }));
    db.close();
    expect(() => store.acquireWorker(() => "boot:new-start")).not.toThrow();
    expect(store.get(draft.id)?.status).toBe("uncertain");
    const competitor = open(path, "container");
    expect(() => competitor.acquireWorker(() => "boot:new-start")).toThrow("already owns");
  });

  test("a stale local worker can be replaced and its interrupted submissions become uncertain", () => {
    const path = statePath();
    const initial = new SignalStore(path, "test");
    const pending = initial.forTweet("12345");
    pending.status = "submitting";
    initial.save(pending);
    const completed = initial.forTweet("67890");
    completed.status = "submitted";
    completed.noteId = "98765";
    initial.save(completed);
    initial.close();
    const database = new Database(path);
    // A positive PID beyond the OS PID range cannot be an existing local process.
    database.query("INSERT INTO metadata (key, value) VALUES ('worker', ?)")
      .run(JSON.stringify({ pid: 2_147_483_647, host: hostname(), token: "crashed-worker" }));
    database.close();
    const restarted = open(path, "test");
    restarted.acquireWorker();
    expect(restarted.get(pending.id)?.status).toBe("uncertain");
    expect(restarted.get(pending.id)?.lastError).toContain("worker stopped during submission");
    expect(restarted.get(completed.id)?.status).toBe("submitted");
    expect(restarted.get(completed.id)?.noteId).toBe("98765");
  });

  test("a worker on another host cannot be displaced based on local PID inspection", () => {
    const path = statePath();
    const store = open(path);
    const database = new Database(path);
    database.query("INSERT INTO metadata (key, value) VALUES ('worker', ?)")
      .run(JSON.stringify({ pid: 2_147_483_647, host: "another-host.example", token: "remote-worker" }));
    database.close();
    expect(() => store.acquireWorker()).toThrow("already owns");
  });

  test("upgrading a legacy inbox preserves old dedupe IDs without replaying them", () => {
    const path = statePath();
    const database = new Database(path, { create: true });
    database.exec("CREATE TABLE inbox (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)");
    database.query("INSERT INTO inbox VALUES (?, ?)").run("old-approval", 1_800_000_000_000);
    database.close();
    const store = open(path);
    expect(store.pendingMessages()).toEqual([]);
    expect(store.enqueueMessage({ id: "old-approval", sender: "human", timestamp: 1_800_000_000_000, text: "yes post" })).toBe(false);
    expect(store.beginMessage("old-approval")).toBe(false);
  });
});
