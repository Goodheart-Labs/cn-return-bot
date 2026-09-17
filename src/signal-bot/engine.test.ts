import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SignalBot } from "./engine";
import { SignalStore, type Conversation } from "./store";
import { createDraftingAdapter } from "./drafting";
import { TweetLookupError } from "../api/fetchTweetById";
import type { DraftContext, DraftResult, DraftingAdapter, SignalDraft, TweetInspection } from "./drafting";
import type { IncomingMessage } from "./transport";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";

const draft: SignalDraft = { text: "The photograph was taken in 2020.", sources: ["https://example.com/archive"] };
const revised: SignalDraft = { text: "The original photograph dates to May 2020.", sources: ["https://example.org/original", "https://example.com/archive"] };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
type SubmissionCallbacks = Parameters<ConstructorParameters<typeof SignalBot>[0]["submit"]>[1];

function fixture(options: {
  store?: SignalStore;
  dryRun?: boolean;
  onSend?: (text: string) => void;
  inspect?: (tweetId: string) => Promise<TweetInspection>;
  draft?: (context: DraftContext) => Promise<DraftResult>;
  converse?: NonNullable<DraftingAdapter["converse"]>;
  submit?: (conversation: Conversation, callbacks?: SubmissionCallbacks) => Promise<SubmissionResult>;
  registerSubmission?: (conversation: Conversation) => Promise<SubmissionResult | null>;
  cancelSubmission?: (conversation: Conversation) => Promise<void>;
  addressedOnly?: boolean;
} = {}) {
  const store = options.store ?? new SignalStore(":memory:", "test-account/group");
  if (!options.store) cleanups.push(() => store.close());
  let now = 1_800_000_000_000;
  let failSend = false;
  const sent: Array<{ id: string; text: string; quote?: IncomingMessage }> = [];
  const inspections: string[] = [];
  const draftCalls: DraftContext[] = [];
  const submissions: Conversation[] = [];
  const cancellations: Conversation[] = [];
  const errors: unknown[] = [];
  const logs: string[] = [];
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
      ...(options.converse ? { converse: options.converse } : {}),
    },
    log: line => logs.push(line),
    send: async (text, quote) => {
      options.onSend?.(text);
      if (failSend) throw new Error("Signal is offline");
      const id = String(now += 10);
      sent.push({ id, text, quote });
      return id;
    },
    submit: async (conversation, callbacks) => {
      submissions.push(structuredClone(conversation));
      if (options.submit) return options.submit(conversation, callbacks);
      callbacks?.onSubmitting();
      return { status: "submitted", noteId: "987654321" };
    },
    cancelSubmission: async conversation => {
      cancellations.push(structuredClone(conversation));
      await options.cancelSubmission?.(conversation);
    },
    registerSubmission: options.registerSubmission,
    dryRun: options.dryRun,
    addressedOnly: options.addressedOnly,
    onError: error => errors.push(error),
  });
  function message(text: string, quoteId?: string, timestamp?: number): IncomingMessage {
    const ts = timestamp ?? (now += 100);
    return { id: `human:${ts}`, sender: "human", timestamp: ts, text, ...(quoteId ? { quoteId } : {}) };
  }
  return {
    bot, store, sent, inspections, draftCalls, submissions, cancellations, errors, logs, message,
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

  test("every reply is labelled as the bot's, with the conversation header when there is one", async () => {
    const f = fixture();
    await f.send("hello?");
    expect(f.sent[0]!.text).toMatch(/^Bot: /);
    await f.send("https://x.com/example/status/12345");
    expect(f.sent.slice(1).every(item => item.text.startsWith("Bot · #1 · 12345\n"))).toBe(true);
    expect(f.logs.some(line => /^received \d+ chars with 1 tweet link$/.test(line))).toBe(true);
    expect(f.logs.some(line => /^reply \d+ chars on #1 showing draft$/.test(line))).toBe(true);
    expect(f.logs.join("\n")).not.toContain("12345");
  });

  test("messages with no tweet get a general answer built from conversation summaries", async () => {
    const seen: Array<Parameters<NonNullable<DraftingAdapter["converse"]>>[0]> = [];
    const f = fixture({ converse: async context => { seen.push(context); return "Paste a link and I will draft a note."; } });
    await f.send("what can you do?");
    expect(seen).toEqual([{ text: "what can you do?", history: [], conversations: [] }]);
    expect(f.sent.at(-1)!.text).toBe("Bot: Paste a link and I will draft a note.");
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post");
    expect(f.current().status).toBe("submitted");
    await f.send("what did we post?");
    expect(seen.at(-1)!.conversations).toEqual([{ id: 1, tweetId: "12345", status: "submitted", draftVersion: 1, draft: `${draft.text} ${draft.sources[0]}`, noteId: "987654321", lastActivityAt: expect.any(Number) }]);
    expect(seen.at(-1)!.history).toEqual([{ role: "user", content: "what can you do?" }, { role: "assistant", content: "Paste a link and I will draft a note." }]);
    expect(f.draftCalls).toHaveLength(1);
    expect(f.submissions).toHaveLength(1);
  });

  test("without a chat model, or when it fails, the fallback still explains how to start", async () => {
    const plain = fixture();
    await plain.send("hello?");
    expect(plain.sent.at(-1)!.text).toContain("Paste a tweet link");
    const failing = fixture({ converse: async () => { throw new Error("model down"); } });
    await failing.send("hello?");
    expect(failing.sent.at(-1)!.text).toContain("Paste a tweet link");
    expect(failing.errors).toHaveLength(1);
    await failing.send("yes post");
    expect(failing.sent.at(-1)!.text).toContain("no open conversation");
    expect(failing.submissions).toHaveLength(0);
  });

  test("with several open tweets, discussion goes to the most recently discussed one", async () => {
    const f = fixture({ converse: async () => "general" });
    await f.send("https://x.com/example/status/12345");
    await f.send("https://x.com/example/status/67890");
    await f.send("Is the date right?");
    expect(f.draftCalls.at(-1)!.post.id).toBe("67890");
    expect(f.sent.at(-1)!.text).toMatch(/^Bot · #2 · 67890\n/);
    await f.send("#1 What about this one?");
    expect(f.draftCalls.at(-1)!.post.id).toBe("12345");
    await f.send("And the wording?");
    expect(f.draftCalls.at(-1)!.post.id).toBe("12345");
    expect(f.sent.at(-1)!.text).toMatch(/^Bot · #1 · 12345\n/);
    await f.send("draft");
    expect(f.sent.at(-1)!.text).toContain("Which tweet do you mean?");
    expect(f.sent.at(-1)!.text).toContain("#1 · 12345\n#2 · 67890");
    expect(f.sent.filter(item => item.text.startsWith("Bot: general"))).toHaveLength(0);
  });

  test("addressed-only mode ignores chatter but answers links, #numbers, mentions, quotes, and a leading bot", async () => {
    const f = fixture({ addressedOnly: true, converse: async context => `chat: ${context.text}` });
    await f.send("morning all");
    expect(f.sent).toHaveLength(0);
    expect(f.logs).toContain("ignored: not addressed to the bot");
    await f.send("yes post");
    expect(f.sent.at(-1)!.text).toContain("no open conversation");
    await f.send("https://x.com/example/status/12345");
    expect(f.current().draft?.version).toBe(1);
    const shown = f.sent.length;
    await f.send("I think the note is fine");
    expect(f.sent).toHaveLength(shown);
    await f.send("#1 Does that source establish the date?");
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe("Does that source establish the date?");
    await f.bot.handle({ ...f.message("what is the source?"), mentionsBot: true });
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe("what is the source?");
    await f.bot.handle({ ...f.message("and the wording?"), quotesBot: true });
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe("and the wording?");
    await f.send("Bot: is it ready?");
    expect(f.draftCalls.at(-1)!.history.at(-1)!.content).toBe("is it ready?");
    // A bare exact command with one open conversation is a bot command, not chatter.
    await f.send("yes post");
    expect(f.submissions).toHaveLength(1);
    expect(f.current().status).toBe("submitted");
    await f.send("bot what did we post?");
    expect(f.sent.at(-1)!.text).toBe("Bot: chat: what did we post?");
  });

  test("messages from a listen-only group only get a general answer when addressed, never a draft", async () => {
    const f = fixture({ converse: async context => `chat: ${context.text}` });
    const live = "group.live";
    await f.bot.handle({ ...f.message("what a note"), fromGroup: live });
    await f.bot.handle({ ...f.message("https://x.com/example/status/12345"), fromGroup: live, mentionsBot: true });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.text).toBe("Bot: chat: https://x.com/example/status/12345");
    expect(f.sent[0]!.quote?.fromGroup).toBe(live);
    expect(f.store.all()).toHaveLength(0);
    await f.bot.handle({ ...f.message("bot which notes went out?"), fromGroup: live });
    expect(f.sent.at(-1)!.text).toBe("Bot: chat: which notes went out?");
    await f.bot.handle({ ...f.message("yes post"), fromGroup: live, quotesBot: true });
    expect(f.sent.at(-1)!.text).toBe("Bot: chat: yes post");
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
    await f.bot.retryQueued();
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
    const f = fixture({ submit: async (_conversation, callbacks) => { callbacks?.onSubmitting(); throw new Error("connection reset after send"); } });
    await f.send("https://x.com/example/status/12345");
    const quote = f.latestDraft().id;
    await f.send("yes post", quote);
    expect(f.current().status).toBe("uncertain");
    await f.bot.retryQueued();
    await f.send("yes post", quote);
    expect(f.submissions).toHaveLength(1);
    expect(f.sent.at(-1)!.text).toContain("reconcile");
  });

  test("an explicit writing-limit rejection queues the exact approved draft", async () => {
    const f = fixture({ submit: async () => ({ status: "daily_limit" }) });
    await f.send("https://x.com/example/status/12345");
    const current = structuredClone(f.current().draft);
    await f.send("yes post", f.latestDraft().id);
    expect(f.current().status).toBe("queued");
    expect(f.current().draft).toEqual(current);
    expect(f.sent.at(-1)!.text).toContain("writing limit");
    expect(f.submissions).toHaveLength(1);
  });

  test("blocked retries keep the approved snapshot and prepared run without repeating queue notices or research", async () => {
    let available = false;
    const f = fixture({ submit: async (conversation, callbacks) => {
      expect(f.store.get(conversation.id)?.status).toBe("queued");
      callbacks?.onPrepared?.("run-for-approved-version");
      expect(f.current().submissionRunId).toBe("run-for-approved-version");
      if (!available) return { status: "deferred", message: "Capacity lookup temporarily unavailable" };
      callbacks?.onSubmitting();
      expect(f.current().status).toBe("submitting");
      return { status: "submitted", noteId: "987654321" };
    } });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post", f.latestDraft().id);
    const approved = structuredClone(f.current().approval);
    const sent = f.sent.length;
    await f.bot.retryQueued();
    await f.bot.retryQueued();
    expect(f.sent).toHaveLength(sent);
    expect(f.current().lastSubmissionResult?.status).toBe("deferred");
    expect(f.current().lastSubmissionAttemptAt).toBeGreaterThan(0);
    available = true;
    await f.bot.retryQueued();
    expect(f.current().status).toBe("submitted");
    expect(f.submissions.map(item => item.approval)).toEqual([approved, approved, approved, approved]);
    expect(f.submissions.slice(1).every(item => item.submissionRunId === "run-for-approved-version")).toBe(true);
    expect(f.draftCalls).toHaveLength(1);
    expect(f.inspections).toHaveLength(1);
    expect(f.sent).toHaveLength(sent + 1);
  });

  test("queued approvals survive restart and resume the frozen version without another model call", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-queued-restart-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "state.sqlite");
    const firstStore = new SignalStore(path, "same-scope");
    const first = fixture({ store: firstStore, submit: async (_conversation, callbacks) => {
      callbacks?.onPrepared?.("durable-run");
      throw new Error("registration connection interrupted before X");
    } });
    await first.send("https://x.com/example/status/12345");
    await first.send("yes post");
    const approval = first.current().approval;
    expect(first.current().status).toBe("queued");
    firstStore.close();
    const store = new SignalStore(path, "same-scope");
    cleanups.push(() => store.close());
    store.acquireWorker();
    const resumed = fixture({ store });
    await resumed.bot.resumePending();
    await resumed.bot.retryQueued();
    expect(resumed.submissions[0]?.approval).toEqual(approval);
    expect(resumed.submissions[0]?.submissionRunId).toBe("durable-run");
    expect(resumed.current().status).toBe("submitted");
    expect(resumed.draftCalls).toEqual([]);
    expect(resumed.inspections).toEqual([]);
  });

  test("queued approvals retry in worker approval order, including before a newly approved draft", async () => {
    let available = false;
    const f = fixture({ submit: async (conversation, callbacks) => {
      if (!available) return { status: "deferred", message: "Registration unavailable" };
      callbacks?.onSubmitting();
      return { status: "submitted", noteId: `note-${conversation.id}` };
    } });
    await f.send("https://x.com/example/status/12345");
    await f.send("https://x.com/example/status/67890");
    await f.send("#2 yes post");
    await f.send("#1 yes post");
    expect(f.submissions.map(item => item.id)).toEqual([2, 2]);
    expect(f.store.queued().map(item => item.id)).toEqual([2, 1]);
    const before = f.submissions.length;
    available = true;
    await f.bot.retryQueued();
    expect(f.submissions.slice(before).map(item => item.id)).toEqual([2, 1]);
    expect(f.store.queued()).toEqual([]);
  });

  test("registers every approved successor before the head can submit and release shared priority", async () => {
    let available = false;
    const registered = new Set<number>();
    const events: string[] = [];
    const f = fixture({
      registerSubmission: async conversation => {
        events.push(`register:${conversation.id}`);
        registered.add(conversation.id);
        return null;
      },
      submit: async (conversation, callbacks) => {
        if (!available) return { status: "daily_limit" };
        events.push(`submit:${conversation.id}`);
        expect(f.store.queued().every(item => registered.has(item.id))).toBe(true);
        callbacks?.onSubmitting();
        return { status: "submitted", noteId: `note-${conversation.id}` };
      },
      cancelSubmission: async conversation => {
        registered.delete(conversation.id);
        if (conversation.id === 1) expect(registered.has(2)).toBe(true);
      },
    });
    await f.send("https://x.com/example/status/12345");
    await f.send("https://x.com/example/status/67890");
    await f.send("#1 yes post");
    await f.send("#2 yes post");
    expect([...registered]).toEqual([1, 2]);
    events.length = 0;
    available = true;
    await f.bot.retryQueued();
    expect(events).toEqual(["register:1", "register:2", "submit:1", "submit:2"]);
    expect(registered.size).toBe(0);
  });

  test("registration failures block all submissions and cannot let a younger approval overtake", async () => {
    let registrationAvailable = false;
    const registered: number[] = [];
    const f = fixture({ registerSubmission: async conversation => {
      registered.push(conversation.id);
      return registrationAvailable ? null : { status: "deferred", message: "Registration offline" };
    } });
    await f.send("https://x.com/example/status/12345");
    await f.send("https://x.com/example/status/67890");
    await f.send("#2 yes post");
    await f.send("#1 yes post");
    expect(registered).toEqual([2, 2]);
    expect(f.submissions).toHaveLength(0);
    registrationAvailable = true;
    await f.bot.retryQueued();
    expect(registered).toEqual([2, 2, 2, 1]);
    expect(f.submissions.map(item => item.id)).toEqual([2, 1]);
  });

  test("queued status remains routable and a cancellation removes shared priority before clearing local approval", async () => {
    const f = fixture({ submit: async () => ({ status: "daily_limit" }), cancelSubmission: async conversation => {
      expect(conversation.status).toBe("cancelling");
      expect(f.current().status).toBe("cancelling");
      expect(f.current().approval).toEqual(conversation.approval);
      expect(f.current().draft).toBeDefined();
    } });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post");
    await f.send("status");
    expect(f.sent.at(-1)?.text).toContain("approved and queued");
    expect(f.sent.at(-1)?.text).not.toContain("Reply ‘yes post’");
    await f.send("cancel");
    expect(f.cancellations).toHaveLength(1);
    expect(f.current().status).toBe("open");
    expect(f.current().approval).toBeUndefined();
    expect(f.current().draft).toBeUndefined();
    expect(f.current().submissionRunId).toBeUndefined();
    await f.bot.retryQueued();
    expect(f.submissions).toHaveLength(1);
  });

  test("a failed withdrawal survives restart and resumes cancellation instead of resurrecting approval", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-cancel-restart-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "state.sqlite");
    const firstStore = new SignalStore(path, "same-scope");
    const first = fixture({ store: firstStore, submit: async () => ({ status: "daily_limit" }),
      cancelSubmission: async () => { throw new Error("Lost acknowledgement after removing priority"); } });
    await first.send("https://x.com/example/status/12345");
    await first.send("yes post");
    await first.send("withdraw");
    expect(first.current().status).toBe("cancelling");
    expect(first.current().approval).toBeDefined();
    firstStore.close();
    const store = new SignalStore(path, "same-scope");
    cleanups.push(() => store.close());
    store.acquireWorker();
    const resumed = fixture({ store });
    await resumed.bot.retryQueued();
    expect(resumed.cancellations).toHaveLength(1);
    expect(resumed.submissions).toHaveLength(0);
    expect(resumed.current().status).toBe("open");
    expect(resumed.current().draft).toBeUndefined();
    expect(resumed.current().approval).toBeUndefined();
  });

  test("revising a queued draft withdraws its approval before drafting and requires approval again", async () => {
    const f = fixture({ submit: async () => ({ status: "daily_limit" }), draft: async context => {
      if (!context.currentDraft) return { reply: "First draft", draft };
      expect(f.cancellations).toHaveLength(1);
      expect(f.current().status).toBe("open");
      expect(f.current().approval).toBeUndefined();
      expect(f.current().submissionRunId).toBeUndefined();
      return { reply: "Revised", draft: revised };
    } });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post");
    await f.send("Use the original date");
    expect(f.current().draft?.version).toBe(2);
    await f.bot.retryQueued();
    expect(f.submissions).toHaveLength(1);
    await f.send("yes post");
    expect(f.submissions.at(-1)?.approval?.version).toBe(2);
  });

  test("a changed queued draft is withdrawn instead of submitting under the earlier approval", async () => {
    const f = fixture({ submit: async () => ({ status: "daily_limit" }) });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post");
    const conversation = f.current();
    conversation.draft = { ...revised, version: 2, shownAt: conversation.draft!.shownAt };
    f.store.save(conversation);
    await f.bot.retryQueued();
    expect(f.submissions).toHaveLength(1);
    expect(f.cancellations).toHaveLength(1);
    expect(f.current().status).toBe("open");
    expect(f.current().approval).toBeUndefined();
    expect(f.sent.at(-1)?.text).toContain("no longer matches");
  });

  test("a received cancellation wins even when a retry poll was scheduled first", async () => {
    const f = fixture({ submit: async () => ({ status: "daily_limit" }) });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post");
    const retry = f.bot.retryQueued();
    const cancel = f.send("cancel");
    await Promise.all([retry, cancel]);
    expect(f.submissions).toHaveLength(1);
    expect(f.cancellations).toHaveLength(1);
    expect(f.current().status).toBe("open");
  });

  test("cancellation received during submission preparation stops the request at the X boundary", async () => {
    let started!: () => void;
    const preparing = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const prepared = new Promise<void>(resolve => { release = resolve; });
    let xRequests = 0;
    const f = fixture({ submit: async (_conversation, callbacks) => {
      started();
      await prepared;
      const proceed = callbacks?.onSubmitting();
      expect(proceed).toBe(false);
      expect(f.current().status).toBe("queued");
      if (proceed === false) return { status: "deferred", message: "An incoming command takes priority" };
      xRequests++;
      return { status: "submitted", noteId: "987654321" };
    } });
    await f.send("https://x.com/example/status/12345");
    const approval = f.send("yes post");
    await preparing;
    const cancellation = f.send("cancel");
    expect(f.store.pendingMessages()).toHaveLength(1);
    release();
    await Promise.all([approval, cancellation]);
    expect(xRequests).toBe(0);
    expect(f.cancellations).toHaveLength(1);
    expect(f.current().status).toBe("open");
    expect(f.current().approval).toBeUndefined();
    expect(f.current().draft).toBeUndefined();
  });

  test("lost queue and submission replies cannot lose approval or duplicate an accepted note", async () => {
    let available = false;
    const f = fixture({ submit: async (_conversation, callbacks) => {
      if (!available) return { status: "daily_limit" };
      callbacks?.onSubmitting();
      return { status: "submitted", noteId: "987654321" };
    } });
    await f.send("https://x.com/example/status/12345");
    f.failSending();
    await expect(f.send("yes post")).rejects.toThrow("Signal is offline");
    expect(f.current().status).toBe("queued");
    await f.bot.retryQueued();
    expect(f.current().status).toBe("queued");
    available = true;
    await expect(f.bot.retryQueued()).rejects.toThrow("Signal is offline");
    expect(f.current().status).toBe("submitted");
    const count = f.submissions.length;
    await f.bot.retryQueued();
    expect(f.submissions).toHaveLength(count);
  });

  test("an uncertain outcome retries shared priority cleanup without retrying X", async () => {
    let cleanupAvailable = false;
    const f = fixture({ submit: async (_conversation, callbacks) => {
      callbacks?.onSubmitting();
      throw new Error("connection reset after sending");
    }, cancelSubmission: async () => {
      if (!cleanupAvailable) throw new Error("Database offline");
    } });
    await f.send("https://x.com/example/status/12345");
    await f.send("yes post");
    expect(f.current().status).toBe("uncertain");
    expect(f.current().sharedQueueCleared).toBe(false);
    const sent = f.sent.length;
    await f.bot.retryQueued();
    cleanupAvailable = true;
    await f.bot.retryQueued();
    expect(f.current().sharedQueueCleared).toBe(true);
    expect(f.submissions).toHaveLength(1);
    expect(f.cancellations).toHaveLength(3);
    await f.bot.retryQueued();
    expect(f.cancellations).toHaveLength(3);
    expect(f.sent).toHaveLength(sent);
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
    await f.bot.resumePending();
    expect(f.cancellations).toHaveLength(1);
    expect(f.current().sharedQueueCleared).toBe(true);
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
