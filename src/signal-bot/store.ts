import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { TweetInspection, SignalDraft } from "./drafting";
import type { IncomingMessage } from "./transport";

export interface DraftVersion extends SignalDraft {
  version: number;
  shownAt: number;
}

export interface Conversation {
  id: number;
  tweetId: string;
  inspection?: TweetInspection;
  research?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  draft?: DraftVersion;
  nextVersion: number;
  status: "open" | "submitting" | "submitted" | "uncertain";
  noteId?: string;
  lastError?: string;
  approval?: { sender: string; timestamp: number; version: number; text: string };
}

export interface MessageReference {
  conversationId: number;
  version: number | null;
  showsDraft: boolean;
}

export interface ReceivedMessage extends IncomingMessage {
  /** Worker-observed target at receipt, independent of the sender's clock.
   * Missing/null bindings can never approve a later-created draft on replay. */
  approvalReceipt?: { conversationId: number; version: number } | null;
}

/** A container restart can reuse PID 1. Linux boot ID plus process start ticks
 * distinguishes that process from the worker which previously held the file. */
function processIdentity(pid: number): string | undefined {
  if (process.platform !== "linux") return;
  try {
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
    return boot && start && /^\d+$/.test(start) ? `${boot}:${start}` : undefined;
  } catch { return; }
}

/** Local durable chat state. The shared X submission ledger lives in Supabase.
 * Receipt is persisted before queueing effects. Pending messages replay after
 * restart; messages already being processed never replay an approval. */
export class SignalStore {
  private db: Database;
  private workerToken?: string;

  constructor(path: string, scope: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tweet_id TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL,
        data TEXT,
        status TEXT NOT NULL DEFAULT 'done'
      );
      CREATE TABLE IF NOT EXISTS message_references (
        message_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL,
        version INTEGER,
        shows_draft INTEGER NOT NULL,
        PRIMARY KEY (message_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS bot_outputs (
        digest TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
    `);
    try {
      this.db.transaction(() => {
        const stored = this.db.query<{ value: string }, [string]>("SELECT value FROM metadata WHERE key = ?").get("scope");
        if (stored && stored.value !== scope) throw new Error("This Signal state file belongs to a different account, group, database, or run mode. Choose a different SIGNAL_STATE_PATH.");
        this.db.query("INSERT OR IGNORE INTO metadata (key, value) VALUES ('scope', ?)").run(scope);
        // Old inbox rows recorded only dedupe IDs. They must remain completed,
        // never become replayable approvals during a schema upgrade.
        const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(inbox)").all();
        if (!columns.some(column => column.name === "data")) this.db.exec("ALTER TABLE inbox ADD COLUMN data TEXT");
        if (!columns.some(column => column.name === "status")) this.db.exec("ALTER TABLE inbox ADD COLUMN status TEXT NOT NULL DEFAULT 'done'");
      }).immediate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** One worker per local state file. A crashed local PID can be replaced, but
   * a worker on another host or an apparently live PID is never displaced. */
  acquireWorker(identityForPid: (pid: number) => string | undefined = processIdentity): void {
    const token = crypto.randomUUID();
    this.db.transaction(() => {
      const row = this.db.query<{ value: string }, []>("SELECT value FROM metadata WHERE key = 'worker'").get();
      if (row) {
        const previous = JSON.parse(row.value) as { pid: number; host: string; processIdentity?: string };
        let alive = true;
        if (previous.host === hostname()) {
          try { process.kill(previous.pid, 0); }
          catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
          const runningIdentity = identityForPid(previous.pid);
          if (previous.processIdentity && runningIdentity && previous.processIdentity !== runningIdentity) alive = false;
        }
        if (alive) throw new Error("A Signal bot already owns this state file. Stop that worker before starting another.");
      }
      this.db.query("INSERT OR REPLACE INTO metadata (key, value) VALUES ('worker', ?)")
        .run(JSON.stringify({ pid: process.pid, host: hostname(), token, processIdentity: identityForPid(process.pid) }));
      this.workerToken = token;
      for (const conversation of this.all()) {
        if (conversation.status === "submitting") {
          conversation.status = "uncertain";
          conversation.lastError = "The worker stopped during submission. Check X and reconcile the submission ledger before trying again.";
          this.save(conversation);
        }
      }
    }).immediate();
  }

  claimMessage(id: string): boolean {
    return this.db.query("INSERT OR IGNORE INTO inbox (id, received_at) VALUES (?, ?)").run(id, Date.now()).changes === 1;
  }

  /** Save before sending: an echo can arrive before the HTTP response, or the
   * response can be lost entirely. Exact output hashes survive either case. */
  recordBotOutput(text: string): void {
    const digest = createHash("sha256").update(text).digest("hex");
    this.db.query("INSERT OR IGNORE INTO bot_outputs (digest, created_at) VALUES (?, ?)").run(digest, Date.now());
  }

  isBotOutput(text: string): boolean {
    const digest = createHash("sha256").update(text).digest("hex");
    return !!this.db.query("SELECT 1 FROM bot_outputs WHERE digest = ?").get(digest);
  }

  /** Synchronous durable receipt; call this before waiting for any earlier work. */
  enqueueMessage(message: ReceivedMessage): boolean {
    return this.db.query("INSERT OR IGNORE INTO inbox (id, received_at, data, status) VALUES (?, ?, ?, 'pending')")
      .run(message.id, Date.now(), JSON.stringify(message)).changes === 1;
  }

  pendingMessages(): ReceivedMessage[] {
    // Signal sender timestamps may be out of order. SQLite rowid preserves this
    // worker's actual receive order, including messages received in the same ms.
    return this.db.query<{ data: string }, []>("SELECT data FROM inbox WHERE status = 'pending' AND data IS NOT NULL ORDER BY rowid")
      .all().map(row => JSON.parse(row.data) as ReceivedMessage);
  }

  beginMessage(id: string): boolean {
    return this.db.query("UPDATE inbox SET status = 'processing' WHERE id = ? AND status = 'pending'")
      .run(id).changes === 1;
  }

  finishMessage(id: string): void {
    this.db.query("UPDATE inbox SET status = 'done' WHERE id = ? AND status = 'processing'").run(id);
  }

  get(id: number): Conversation | undefined {
    const row = this.db.query<{ id: number; data: string }, [number]>("SELECT id, data FROM conversations WHERE id = ?").get(id);
    return row ? { ...JSON.parse(row.data), id: row.id } : undefined;
  }

  forTweet(tweetId: string): Conversation {
    return this.db.transaction(() => {
      const row = this.db.query<{ id: number; data: string }, [string]>("SELECT id, data FROM conversations WHERE tweet_id = ?").get(tweetId);
      if (row) return { ...JSON.parse(row.data), id: row.id } as Conversation;
      const data = { tweetId, history: [], nextVersion: 1, status: "open" };
      const inserted = this.db.query("INSERT INTO conversations (tweet_id, data) VALUES (?, ?)").run(tweetId, JSON.stringify(data));
      return { ...data, id: Number(inserted.lastInsertRowid) } as Conversation;
    }).immediate();
  }

  all(): Conversation[] {
    return this.db.query<{ id: number; data: string }, []>("SELECT id, data FROM conversations ORDER BY id").all()
      .map((row) => ({ ...JSON.parse(row.data), id: row.id }));
  }

  save(conversation: Conversation): void {
    this.db.query("UPDATE conversations SET data = ? WHERE id = ?").run(JSON.stringify(conversation), conversation.id);
  }

  reference(messageId: string, conversationId: number, version: number | null, showsDraft = false): void {
    // First observation wins. A human message with a colliding timestamp must
    // not overwrite the version attached to an already displayed draft.
    this.db.query("INSERT OR IGNORE INTO message_references (message_id, conversation_id, version, shows_draft) VALUES (?, ?, ?, ?)")
      .run(messageId, conversationId, version, showsDraft ? 1 : 0);
  }

  resolve(messageId: string): MessageReference | undefined {
    const rows = this.db.query<{ conversation_id: number; version: number | null; shows_draft: number }, [string]>(
      "SELECT conversation_id, version, shows_draft FROM message_references WHERE message_id = ?",
    ).all(messageId);
    if (rows.length !== 1) return undefined;
    const row = rows[0]!;
    return { conversationId: row.conversation_id, version: row.version, showsDraft: !!row.shows_draft };
  }

  close(): void {
    if (this.workerToken) {
      this.db.query("DELETE FROM metadata WHERE key = 'worker' AND json_extract(value, '$.token') = ?").run(this.workerToken);
      this.workerToken = undefined;
    }
    this.db.close();
  }
}
