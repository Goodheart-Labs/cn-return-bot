import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SignalBot } from "./engine";
import { SignalStore, type Conversation } from "./store";
import { createDraftingAdapter } from "./drafting";
import { TweetLookupError } from "../api/fetchTweetById";
import type { DraftContext, DraftResult, SignalDraft, TweetInspection } from "./drafting";
import type { IncomingMessage } from "./transport";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";

const draft: SignalDraft = { text: "The photograph was taken in 2020.", sources: ["https://example.com/archive"] };
const revised: SignalDraft = { text: "The original photograph dates to May 2020.", sources: ["https://example.org/original", "https://example.com/archive"] };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture(options: {
  store?: SignalStore;
  dryRun?: boolean;
  onSend?: (text: string) => void;
  inspect?: (tweetId: string) => Promise<TweetInspection>;
  draft?: (context: DraftContext) => Promise<DraftResult>;
  submit?: (conversation: Conversation) => Promise<SubmissionResult>;
} = {}) {
  const store = options.store ?? new SignalStore(":memory:", "test-account/group");
  if (!options.store) cleanups.push(() => store.close());
  let now = 1_800_000_000_000;
  let failSend = false;
  const sent: Array<{ id: string; text: string; quote?: IncomingMessage }> = [];
  const inspections: string[] = [];
  const draftCalls: DraftContext[] = [];
  const submissions: Conversation[] = [];
  const errors: unknown[] = [];
  const bot = new SignalBot({
    store,
    drafting: {
      inspect: async tweetId => {
        inspections.push(tweetId);
        if (options.inspect) return options.inspect(tweetId);
        return {
          tweetId, access: "readable", eligibility: "unconfirmed",
          detail: "I can read this tweet; eligibility is unconfirmed.",
          post: { id: tweetId, author_id: "1", text: "This photo was taken today.", created_at: "2026-09-13T00:00:00Z", media: [] },
        };
      },
      draft: async context => {
        draftCalls.push(structuredClone(context));
        if (options.draft) return options.draft(context);
        if (context.currentDraft) return { reply: "The archive records the date. Shall we discuss the wording?" };
        return { reply: "The source provides the original date.", draft: structuredClone(draft), research: "Archive research" };
      },
    },
    send: async (text, quote) => {
      options.onSend?.(text);
      if (failSend) throw new Error("Signal is offline");
      const id = String(now += 10);
      sent.push({ id, text, quote });
      return id;
    },
    submit: async conversation => {
      submissions.push(structuredClone(conversation));
      return options.submit ? options.submit(conversation) : { status: "submitted", noteId: "987654321" };
    },
    dryRun: options.dryRun,
    onError: error => errors.push(error),
  });
  function message(text: string, quoteId?: string, timestamp?: number): IncomingMessage {
    const ts = timestamp ?? (now += 100);
    return { id: `human:${ts}`, sender: "human", timestamp: ts, text, ...(quoteId ? { quoteId } : {}) };
  }
  return {
    bot, store, sent, inspections, draftCalls, submissions, errors, message,
    failSending: () => { failSend = true; },
    restoreSending: () => { failSend = false; },
    send: async (text: string, quoteId?: string) => bot.handle(message(text, quoteId)),
    current: () => store.all()[0]!,
    latestDraft: () => sent.findLast(item => item.text.includes("Proposed note"))!,
  };
}

describe("Signal draft conversations", () => {
  test("a tweet triggers an access check and theoretical sourced draft, without submission", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    expect(f.inspections).toEqual(["12345"]);
    expect(f.sent[0]!.text).toContain("eligibility is unconfirmed");
    expect(f.latestDraft().text).toContain(`${draft.text} ${draft.sources.join(" ")}`);
    expect(f.latestDraft().text).toContain("v1");
    expect(f.current().draft).toEqual({ ...draft, version: 1, shownAt: Number(f.latestDraft().id) });
    expect(f.submissions).toHaveLength(0);
  });

  test("an inaccessible tweet reports failure and does not fabricate a draft", async () => {
    const f = fixture({ inspect: async tweetId => ({ tweetId, access: "unavailable", eligibility: "unconfirmed", detail: "I cannot retrieve this tweet." }) });
    await f.send("https://twitter.com/example/status/12345");
    expect(f.sent.at(-1)!.text).toContain("cannot retrieve");
    expect(f.draftCalls).toHaveLength(0);
    expect(f.current().draft).toBeUndefined();
    await f.send("yes post");
    expect(f.submissions).toHaveLength(0);
  });

  test("a failed direct lookup saves a useful status and retry can draft before human approval", async () => {
    let attempts = 0;
    const adapter = createDraftingAdapter({
      fetchPost: async tweetId => {
        if (++attempts === 1) throw new TweetLookupError("http", "private API response", 429);
        return { id: tweetId, author_id: "1", text: "This photo was taken today.", created_at: "2026-09-13T00:00:00Z", media: [] };
      },
    });
    const f = fixture({ inspect: adapter.inspect });
    await f.send("https://x.com/example/status/12345");
    expect(f.current().inspection?.detail).toContain("rate-limited");
    expect(f.draftCalls).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
    expect(JSON.stringify(f.current())).not.toContain("private API response");

    await f.send("#1 status");
    expect(f.sent.at(-1)!.text).toContain("HTTP 429");
    expect(attempts).toBe(1);

    await f.send("#1 retry");
    expect(attempts).toBe(2);
    expect(f.current().inspection?.access).toBe("readable");
    expect(f.current().inspection?.eligibility).toBe("unconfirmed");
    expect(f.draftCalls).toHaveLength(1);
    expect(f.submissions).toHaveLength(0);
    await f.send("yes post", f.latestDraft().id);
    expect(f.submissions).toHaveLength(1);
    expect(f.current().status).toBe("submitted");
  });

  test("discussion retains the current draft and cannot post via model prose", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const original = structuredClone(f.current().draft);
    await f.send("Does that source establish when it was taken?", f.latestDraft().id);
    expect(f.current().draft).toEqual(original);
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe("Does that source establish when it was taken?");
    expect(f.sent.at(-1)!.text).toContain("archive records");
    expect(f.submissions).toHaveLength(0);
  });

  test("the account owner's synced messages can draft and approve while exact bot replies are ignored", async () => {
    const f = fixture();
    await f.bot.handle({ ...f.message("https://x.com/example/status/12345"), isSelf: true });
    const shown = f.latestDraft();
    const before = f.sent.length;
    await f.bot.handle({ ...f.message(shown.text), isSelf: true });
    expect(f.sent).toHaveLength(before);
    expect(f.draftCalls).toHaveLength(1);
    await f.bot.handle({ ...f.message("yes post", shown.id), isSelf: true });
    expect(f.submissions).toHaveLength(1);
  });

  test("generic bot responses are recorded before send so echoes cannot form a feedback loop", async () => {
    const store = new SignalStore(":memory:", "self-account");
    cleanups.push(() => store.close());
    const f = fixture({ store, onSend: text => expect(store.isBotOutput(text)).toBe(true) });
    await f.bot.handle({ ...f.message("hello"), isSelf: true });
    const response = f.sent.at(-1)!.text;
    await f.bot.handle({ ...f.message(response), isSelf: true });
    expect(f.sent).toHaveLength(1);
    expect(f.draftCalls).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
  });

  test("threaded tweet URLs remain source evidence verbatim instead of retargeting the conversation", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const sourceText = "draft: The original says May 2020. https://x.com/source/status/67890 https://twitter.com/archive/status/54321";
    await f.send(`#1 ${sourceText}`);
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe(sourceText);
    expect(f.draftCalls.at(-1)!.post.id).toBe("12345");
    const quotedEvidence = "Use this source https://x.com/source/status/67890";
    await f.send(quotedEvidence, f.latestDraft().id);
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe(quotedEvidence);
    expect(f.inspections).toEqual(["12345"]);
    expect(f.store.all()).toHaveLength(1);
    expect(f.submissions).toHaveLength(0);
  });

  test("numeric hashtags inside a human draft are preserved as content", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const edit = "draft: Report #42 gives the date as 2020. https://example.org/report";
    await f.send(edit, f.latestDraft().id);
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe(edit);
    expect(f.store.all()).toHaveLength(1);
  });

  test("an invalid explicit conversation number cannot fall back to approving the only open tweet", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    await f.send("#0 yes post");
    await f.send("#999999999999999999999 yes post");
    expect(f.submissions).toHaveLength(0);
    expect(f.current().status).toBe("open");
  });

  test("a bare existing tweet link shows its draft again, and unknown quoted links cannot create targets", async () => {
    const f = fixture();
    const link = "https://x.com/example/status/12345";
    await f.send(link);
    expect(f.draftCalls[0]!.history[0]!.content).toBe(link);
    await f.send(link);
    expect(f.draftCalls).toHaveLength(1);
    expect(f.sent.at(-1)!.text).toContain("Proposed note");
    await f.send("https://x.com/other/status/67890", "9999999999999");
    expect(f.sent.at(-1)!.text).toContain("can’t match");
    expect(f.store.all()).toHaveLength(1);
  });

  test("human revision followed by exact yes post submits the latest text and sources once", async () => {
    const f = fixture({ draft: async context => ({ reply: "Here is the draft.", draft: context.currentDraft ? structuredClone(revised) : structuredClone(draft) }) });
    await f.send("https://x.com/example/status/12345");
    await f.send("Rewrite it using https://example.org/original", f.latestDraft().id);
    const shown = f.latestDraft();
    expect(shown.text).toContain("v2");
    const approval = f.message("yes post", shown.id);
    await f.bot.handle(approval);
    await f.bot.handle(approval);
    expect(f.submissions).toHaveLength(1);
    expect(f.submissions[0]!.draft).toEqual({ ...revised, version: 2, shownAt: Number(shown.id) });
    expect(f.submissions[0]!.approval).toEqual({
      sender: "human", timestamp: approval.timestamp, version: 2,
      text: `${revised.text} ${revised.sources.join(" ")}`,
    });
    expect(f.current().status).toBe("submitted");
    expect(f.current().noteId).toBe("987654321");
    expect(f.sent.at(-1)!.text).toContain("https://x.com/i/communitynotes/987654321");
  });

  test("quoting a stale draft never approves a newer revision", async () => {
    const f = fixture({ draft: async context => ({ reply: "Draft updated.", draft: context.currentDraft ? revised : draft }) });
    await f.send("https://x.com/example/status/12345");
    const first = f.latestDraft().id;
    await f.send("Rewrite it with the original date", first);
    await f.send("yes post", first);
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("current draft is v2");
  });

  test("an approval queued before the draft is shown cannot approve the unseen draft", async () => {
    const f = fixture();
    const tweet = f.message("https://x.com/example/status/12345");
    // An ahead-of-clock sender must not make an unseen draft approvable.
    const earlyYes = f.message("yes post", undefined, 1_900_000_000_000);
    await Promise.all([f.bot.handle(tweet), f.bot.handle(earlyYes)]);
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("before the current draft was shown");
  });

  test("approval received during a rewrite stays bound to the visible version despite clock skew", async () => {
    let release!: () => void;
    let started!: () => void;
    const rewriting = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ draft: async context => {
      if (!context.currentDraft) return { reply: "First draft", draft };
      started();
      await gate;
      return { reply: "Revised draft", draft: revised };
    } });
    await f.send("https://x.com/example/status/12345");
    const rewrite = f.send("Rewrite it");
    await rewriting;
    const approval = f.bot.handle(f.message("yes post", undefined, 1_900_000_000_000));
    expect(f.store.pendingMessages()[0]!.approvalReceipt).toEqual({ conversationId: 1, version: 1 });
    release();
    await Promise.all([rewrite, approval]);
    expect(f.current().draft?.version).toBe(2);
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("before the current draft was shown");
    await f.send("yes post");
    expect(f.submissions[0]!.draft?.version).toBe(2);
  });

  test("a persisted pending approval cannot acquire a newer draft after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-approval-replay-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "state.sqlite");
    const before = new SignalStore(path, "same-scope");
    const conversation = before.forTweet("12345");
    conversation.draft = { ...revised, version: 2, shownAt: 1_800_000_000_000 };
    before.save(conversation);
    before.enqueueMessage({ id: "human:1900000000000", sender: "human", text: "yes post",
      timestamp: 1_900_000_000_000, approvalReceipt: { conversationId: conversation.id, version: 1 } });
    before.close();
    const recovered = new SignalStore(path, "same-scope");
    cleanups.push(() => recovered.close());
    recovered.acquireWorker();
    const f = fixture({ store: recovered });
    await f.bot.resumePending();
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("before the current draft was shown");
    expect(recovered.pendingMessages()).toEqual([]);
  });

  test("an unquoted yes post with two open tweets is ambiguous, while #number selects one", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    await f.send("https://x.com/example/status/67890");
    await f.send("yes post");
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("#number");
    await f.send("#2 yes post");
    expect(f.submissions).toHaveLength(1);
    expect(f.submissions[0]!.tweetId).toBe("67890");
  });

  test("an unknown quote and a conflicting quote/conversation pair fail closed", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const first = f.latestDraft().id;
    await f.send("yes post", "9999999999999");
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("can’t match");
    await f.send("https://x.com/example/status/67890");
    await f.send("#2 yes post", first);
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("different tweets");
  });

  test("plain yes only approves when it quotes an actual displayed draft", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const shown = f.latestDraft().id;
    await f.send("yes");
    await f.send("yes", f.sent[0]!.id); // Access-check response, not the draft.
    expect(f.submissions).toHaveLength(0);
    await f.send("yes", shown);
    expect(f.submissions).toHaveLength(1);
  });

  test("concurrent human approvals and replayed messages submit at most once", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const quoteId = f.latestDraft().id;
    const first = f.message("yes post", quoteId);
    const second = { ...f.message("yes post", quoteId), sender: "another human", id: "another-human-approval" };
    await Promise.all([f.bot.handle(first), f.bot.handle(second), f.bot.handle(first)]);
    expect(f.submissions).toHaveLength(1);
    expect(f.current().status).toBe("submitted");
  });

  test("losing the Signal confirmation after X accepts cannot reopen or retry the submission", async () => {
    const f = fixture();
    await f.send("https://x.com/example/status/12345");
    const quote = f.latestDraft().id;
    f.failSending();
    await expect(f.send("yes post", quote)).rejects.toThrow("Signal is offline");
    expect(f.current().status).toBe("submitted");
    expect(f.current().noteId).toBe("987654321");
    f.restoreSending();
    await f.send("yes post", quote);
    expect(f.submissions).toHaveLength(1);
    expect(f.sent.at(-1)!.text).toContain("Submitted:");
  });

  test("an interrupted X request blocks later retries until reconciliation", async () => {
    const f = fixture({ submit: async () => { throw new Error("connection reset after send"); } });
    await f.send("https://x.com/example/status/12345");
    const quote = f.latestDraft().id;
    await f.send("yes post", quote);
    expect(f.current().status).toBe("uncertain");
    await f.send("yes post", quote);
    expect(f.submissions).toHaveLength(1);
    expect(f.sent.at(-1)!.text).toContain("reconcile");
  });

  test("an explicit writing-limit rejection preserves the draft for a new human attempt", async () => {
    const f = fixture({ submit: async () => ({ status: "daily_limit" }) });
    await f.send("https://x.com/example/status/12345");
    const current = structuredClone(f.current().draft);
    await f.send("yes post", f.latestDraft().id);
    expect(f.current().status).toBe("open");
    expect(f.current().draft).toEqual(current);
    expect(f.sent.at(-1)!.text).toContain("writing limit");
    expect(f.submissions).toHaveLength(1);
  });

  test("dry-run approvals never call the X submission adapter", async () => {
    const f = fixture({ dryRun: true });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post", f.latestDraft().id);
    expect(f.submissions).toHaveLength(0);
    expect(f.current().status).toBe("open");
    expect(f.sent.at(-1)!.text).toContain("Dry run");
  });

  test("restart recovers an in-flight submission as uncertain and refuses to submit it again", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-engine-test-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "state.sqlite");
    const before = new SignalStore(path, "same-scope");
    const conversation = before.forTweet("12345");
    conversation.draft = { ...draft, version: 1, shownAt: 1_799_999_000_000 };
    conversation.status = "submitting";
    before.save(conversation);
    before.reference("1799999000000", conversation.id, 1, true);
    before.close();
    const restarted = new SignalStore(path, "same-scope");
    cleanups.push(() => restarted.close());
    restarted.acquireWorker();
    const f = fixture({ store: restarted });
    await f.send("yes post", "1799999000000");
    expect(f.current().status).toBe("uncertain");
    expect(f.submissions).toHaveLength(0);
    expect(f.sent.at(-1)!.text).toContain("uncertain");
  });

  test("messages waiting behind slow research are durable immediately and replay in receive order after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-inbox-test-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "original.sqlite");
    const snapshot = join(directory, "crash-snapshot.sqlite");
    const store = new SignalStore(path, "test-account/group");
    cleanups.push(() => store.close());
    let started!: () => void;
    const researching = new Promise<void>(resolve => { started = resolve; });
    let finish!: () => void;
    const continueResearch = new Promise<void>(resolve => { finish = resolve; });
    const before = fixture({ store, draft: async () => {
      started();
      await continueResearch;
      return { reply: "Draft ready.", draft };
    } });
    const first = before.bot.handle(before.message("https://x.com/example/status/12345"));
    await researching;
    const next = before.message("https://x.com/example/status/67890");
    const last = before.message("https://x.com/example/status/54321");
    const second = before.bot.handle(next);
    const third = before.bot.handle(last);
    expect(store.pendingMessages().map(message => message.id)).toEqual([next.id, last.id]);
    // Snapshot the durable database exactly as it would appear after a crash,
    // while the original worker's first message is still processing.
    const database = new Database(path);
    database.query("VACUUM INTO ?").run(snapshot);
    database.close();
    finish();
    await Promise.all([first, second, third]);
    const recovered = new SignalStore(snapshot, "test-account/group");
    cleanups.push(() => recovered.close());
    recovered.acquireWorker();
    const after = fixture({ store: recovered });
    await after.bot.resumePending();
    expect(after.inspections).toEqual(["67890", "54321"]);
    expect(recovered.pendingMessages()).toEqual([]);
    expect(after.submissions).toHaveLength(0);
    await after.bot.handle(next);
    expect(after.inspections).toHaveLength(2);
  });

  test("a processing approval is never replayed, even before a submission status was persisted", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-approval-test-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "state.sqlite");
    const before = new SignalStore(path, "same-scope");
    const conversation = before.forTweet("12345");
    conversation.draft = { ...draft, version: 1, shownAt: 1_799_999_000_000 };
    before.save(conversation);
    const approval: IncomingMessage = { id: "human:1800000000000", sender: "human", timestamp: 1_800_000_000_000, text: "yes post" };
    before.enqueueMessage(approval);
    expect(before.beginMessage(approval.id)).toBe(true);
    before.close();
    const recovered = new SignalStore(path, "same-scope");
    cleanups.push(() => recovered.close());
    recovered.acquireWorker();
    const f = fixture({ store: recovered });
    await f.bot.resumePending();
    await f.bot.handle(approval);
    expect(f.submissions).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
    expect(recovered.pendingMessages()).toEqual([]);
  });
});
