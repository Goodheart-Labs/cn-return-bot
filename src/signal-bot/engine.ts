import type { ConversationSummary, DraftingAdapter } from "./drafting";
import { validateSignalDraft } from "./drafting";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import type { IncomingMessage } from "./transport";
import { SignalStore, type Conversation, type MessageReference, type ReceivedMessage } from "./store";

interface EngineDependencies {
  store: SignalStore;
  drafting: DraftingAdapter;
  send: (text: string, quote?: IncomingMessage) => Promise<string>;
  submit: (conversation: Conversation, callbacks?: {
    onPrepared?: (runId: string) => void;
    onSubmitting: () => boolean | void;
  }) => Promise<SubmissionResult>;
  registerSubmission?: (conversation: Conversation) => Promise<SubmissionResult | null>;
  cancelSubmission?: (conversation: Conversation) => Promise<void>;
  dryRun?: boolean;
  /** Stay silent unless a message carries a tweet link, a #number, a quote of or
   * mention of the bot, or a leading "bot". Ordinary group chatter is ignored. */
  addressedOnly?: boolean;
  onError?: (error: unknown) => void;
  /** Operational log line per received message and reply; never message content. */
  log?: (line: string) => void;
}

const MAX_INPUT_CHARS = 6000;
const NO_TARGET_HELP = "Paste a tweet link to get an access check and draft. For an existing tweet, reply to its draft or start your message with its #number.";
const BOT_PREFIX = /^\s*@?(?:cn\s*)?bot\b[:,]?\s*/i;
const TWEET_URL = /https?:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d{1,25})(?:[/?#][^\s]*)?/gi;

function command(text: string): { text: string; tweetIds: string[]; threadId?: number } {
  const tweetIds = [...new Set([...text.matchAll(TWEET_URL)].map((match) => match[1]!))];
  const thread = text.match(/^\s*#(\d+)\b/);
  return {
    tweetIds,
    threadId: thread ? Number(thread[1]) : undefined,
    text: text.replace(/^\s*#\d+\b/, "").trim(),
  };
}

/** The LLM only drafts and discusses. Only these exact human commands can enter
 * the submission branch, and that branch takes a frozen copy of the draft. */
export class SignalBot {
  private queue: Promise<void> = Promise.resolve();

  constructor(private dependencies: EngineDependencies) {}

  handle(message: IncomingMessage): Promise<void> {
    if (message.isSelf && this.dependencies.store.isBotOutput(message.text)) return Promise.resolve();
    // Persist synchronously: a slow LLM call must not leave later received
    // messages only in the transport's memory until it finishes.
    const received: ReceivedMessage = { ...structuredClone(message), approvalReceipt: this.approvalAtReceipt(message) };
    if (!this.dependencies.store.enqueueMessage(received)) return Promise.resolve();
    const parsed = command(message.text);
    this.dependencies.log?.(`received ${message.text.length} chars${parsed.threadId !== undefined ? ` for #${parsed.threadId}` : ""}` +
      `${parsed.tweetIds.length ? ` with ${parsed.tweetIds.length} tweet link${parsed.tweetIds.length > 1 ? "s" : ""}` : ""}${message.quoteId ? " quoting a message" : ""}`);
    return this.schedule(received);
  }

  private approvalAtReceipt(message: IncomingMessage): ReceivedMessage["approvalReceipt"] {
    const parsed = command(message.text);
    if (!/^yes(?:(?:\s*,\s*|\s+)post(?:\s+it)?)?[.!]?$/i.test(parsed.text)) return null;
    const { store } = this.dependencies;
    const quoted = message.quoteId ? store.resolve(message.quoteId) : undefined;
    let conversation = parsed.threadId === undefined ? undefined : store.get(parsed.threadId);
    if (parsed.threadId !== undefined && !conversation) return null;
    if (quoted) {
      if (conversation && quoted.conversationId !== conversation.id) return null;
      conversation ??= store.get(quoted.conversationId);
    }
    if (message.quoteId && !quoted && !conversation) return null;
    if (!conversation) {
      const open = store.all().filter(item => item.status === "open");
      if (open.length === 1) conversation = open[0];
    }
    if (conversation?.status !== "open" || !conversation.draft?.shownAt) return null;
    return { conversationId: conversation.id, version: conversation.draft.version };
  }

  /** Call after acquiring the worker lock, before accepting fresh messages. */
  resumePending(): Promise<void> {
    for (const message of this.dependencies.store.pendingMessages()) this.schedule(message);
    return this.retryQueued();
  }

  drain(): Promise<void> {
    return this.queue;
  }

  retryQueued(): Promise<void> {
    const result = this.queue.then(() => this.processQueued());
    this.queue = result.catch(error => this.dependencies.onError?.(error));
    return result;
  }

  private async processQueued(message?: IncomingMessage, approvedId?: number): Promise<void> {
    const { store, registerSubmission } = this.dependencies;
    if (store.pendingMessages().length) return;
    if (registerSubmission) {
      const results: Array<{ conversation: Conversation; result: SubmissionResult }> = [];
      let ready = true;
      for (const conversation of store.queued()) {
        if (store.pendingMessages().length) return;
        conversation.lastSubmissionAttemptAt = Date.now();
        store.save(conversation);
        let result: SubmissionResult | null;
        try { result = await registerSubmission(structuredClone(conversation)); }
        catch (error) {
          this.dependencies.onError?.(error);
          result = { status: "deferred", message: "Could not register the approved note. No X request was started; I’ll retry automatically." };
        }
        if (!result) continue;
        results.push({ conversation, result });
        if (result.status === "deferred" || result.status === "capacity_reserved" || result.status === "daily_limit") {
          ready = false;
          break;
        }
      }
      // Register successors before removing a completed or withdrawn head.
      for (const { conversation, result } of results) {
        await this.applySubmissionResult(conversation, result, conversation.id === approvedId ? message : undefined);
      }
      if (!ready) return;
    }
    for (const conversation of store.all()) {
      if (store.pendingMessages().length) return;
      if (!conversation.sharedQueueCleared && (conversation.status === "submitted" || conversation.status === "uncertain" ||
        (conversation.status === "open" && conversation.queuedAt !== undefined))) {
        await this.clearTerminalPriority(conversation);
      }
    }
    const cancelling = store.all().filter(conversation => conversation.status === "cancelling");
    for (const conversation of [...cancelling, ...store.queued()]) {
      // Received commands take priority even when this poll was queued first.
      if (store.pendingMessages().length) break;
      if (conversation.status === "cancelling") await this.finishWithdrawal(conversation);
      else await this.attemptSubmission(conversation, conversation.id === approvedId ? message : undefined);
      if (conversation.status === "queued" || conversation.status === "cancelling") break;
    }
  }

  private schedule(message: ReceivedMessage): Promise<void> {
    const result = this.queue.then(async () => {
      // Write ahead of every conversation, Signal, LLM, or X effect. A process
      // crash leaves this message in processing, so its approval never replays.
      if (!this.dependencies.store.beginMessage(message.id)) return;
      try { await this.process(message); }
      finally { this.dependencies.store.finishMessage(message.id); }
    });
    this.queue = result.catch((error) => this.dependencies.onError?.(error));
    return result;
  }

  /** Every reply is prefixed "Bot" because the bot may post from the owner's own account. */
  private async reply(text: string, message?: IncomingMessage, conversation?: Conversation, showsDraft = false): Promise<void> {
    const body = conversation ? `Bot · #${conversation.id} · ${conversation.tweetId}\n${text}` : `Bot: ${text}`;
    this.dependencies.store.recordBotOutput(body);
    this.dependencies.log?.(`reply ${body.length} chars${conversation ? ` on #${conversation.id}` : ""}${showsDraft ? " showing draft" : ""}`);
    const id = await this.dependencies.send(body, message);
    if (conversation) {
      this.dependencies.store.reference(id, conversation.id, conversation.draft?.version ?? null, showsDraft);
      if (showsDraft && conversation.draft) {
        const timestamp = Number(id);
        if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("Signal returned an invalid sent-message timestamp.");
        conversation.draft.shownAt = timestamp;
        this.dependencies.store.save(conversation);
      }
    }
  }

  private async showDraft(conversation: Conversation, message: IncomingMessage, explanation = ""): Promise<void> {
    const draft = conversation.draft;
    if (!draft) {
      await this.reply(explanation || "There is no current draft. Suggest a correction and sources, or say ‘retry’ to research it again.", message, conversation);
      return;
    }
    const note = joinNoteWithSources(draft.text, draft.sources);
    const intro = explanation ? `${explanation.slice(0, 2600)}\n\n` : "";
    const action = conversation.status === "queued"
      ? "This version is approved and queued for the next available capacity. Say ‘cancel’ to withdraw it; requesting changes withdraws approval."
      : "Discuss or suggest changes. Reply ‘yes post’ to submit this version.";
    await this.reply(`${intro}Proposed note · v${draft.version}\n\n${note}\n\n${action}`, message, conversation, true);
  }

  private remember(conversation: Conversation, role: "user" | "assistant", content: string): void {
    conversation.history.push({ role, content });
    conversation.history = conversation.history.slice(-24);
    this.dependencies.store.save(conversation);
  }

  private async process(message: ReceivedMessage): Promise<void> {
    const { store } = this.dependencies;
    // Also check replayed pending messages against the durable output ledger.
    if (message.isSelf && store.isBotOutput(message.text)) return;
    if (message.text.length > MAX_INPUT_CHARS) {
      await this.reply("Please keep each message under 6,000 characters; you can send sources in separate replies.", message);
      return;
    }
    const parsed = command(message.text);
    // In a listen-only group the bot never drafts or approves; a mention, quote,
    // or leading "bot" gets a plain answer there, everything else is ignored.
    if (message.fromGroup) {
      const prefixed = BOT_PREFIX.test(parsed.text);
      if (!message.mentionsBot && !message.quotesBot && !prefixed) return;
      await this.converse(message, prefixed ? parsed.text.replace(BOT_PREFIX, "").trim() : parsed.text);
      return;
    }
    if (parsed.threadId !== undefined && (!Number.isSafeInteger(parsed.threadId) || parsed.threadId < 1)) {
      await this.reply("Use the conversation number shown above the draft, such as #1.", message);
      return;
    }
    const quoted = message.quoteId ? store.resolve(message.quoteId) : undefined;
    const addressedByPrefix = BOT_PREFIX.test(parsed.text);
    if (addressedByPrefix) parsed.text = parsed.text.replace(BOT_PREFIX, "").trim();
    // Exact commands are addressed to the bot by their nature; they still need an
    // unambiguous conversation below, so a stray "yes" cannot approve anything new.
    const exactCommandText = /^(?:cancel|withdraw|status|draft|show draft|yes(?:(?:\s*,\s*|\s+)post(?:\s+it)?)?)[.!]?$/i.test(parsed.text);
    if (this.dependencies.addressedOnly && !parsed.tweetIds.length && parsed.threadId === undefined &&
        !message.mentionsBot && !message.quotesBot && !addressedByPrefix && !exactCommandText) {
      this.dependencies.log?.("ignored: not addressed to the bot");
      return;
    }
    let conversation = parsed.threadId !== undefined ? store.get(parsed.threadId) : undefined;
    if (parsed.threadId !== undefined && !conversation) {
      await this.reply(`I don’t have a conversation #${parsed.threadId}. Paste the tweet link to start one.`, message);
      return;
    }
    if (quoted) {
      if (conversation && quoted.conversationId !== conversation.id) {
        await this.reply("The conversation number and quoted message refer to different tweets. Reply to the draft you mean.", message);
        return;
      }
      conversation ??= store.get(quoted.conversationId);
    }
    // An unknown quote cannot acquire a target merely by containing an X link.
    if (message.quoteId && !quoted && !conversation) {
      await this.reply("I can’t match that reply to a tweet. Include its #conversation number, or reply to my draft.", message);
      return;
    }
    // Explicit conversation routing wins: every included URL is human evidence,
    // including other tweets. Only an unthreaded message selects a new target.
    let bareTargetLink = false;
    if (!conversation && parsed.tweetIds.length) {
      if (parsed.tweetIds.length > 1) {
        await this.reply("Send one tweet per message so each draft has its own conversation.", message);
        return;
      }
      conversation = store.forTweet(parsed.tweetIds[0]!);
      bareTargetLink = !parsed.text.replace(TWEET_URL, "").trim();
    }
    const withdraw = /^(?:cancel|withdraw)[.!]?$/i.test(parsed.text);
    const show = /^(?:status|draft|show draft)[.!]?$/i.test(parsed.text);
    const yesPost = /^yes(?:\s*,\s*|\s+)post(?:\s+it)?[.!]?$/i.test(parsed.text);
    const yes = /^yes[.!]?$/i.test(parsed.text);
    const exactCommand = withdraw || show || yesPost || yes;
    if (!conversation) {
      const open = store.all().filter((item) => item.status === "open" || item.status === "queued" || item.status === "cancelling");
      if (open.length === 1) conversation = open[0];
      else if (open.length > 1) {
        // Exact commands need an unambiguous target. Ordinary discussion goes to
        // the tweet the group last talked about; the reply header names it.
        if (exactCommand) {
          const list = open.map((item) => `#${item.id} · ${item.tweetId}`).join("\n");
          await this.reply(`Which tweet do you mean? Reply to its draft or start your message with its #number.\n${list}`, message);
          return;
        }
        conversation = open.reduce((latest, item) =>
          (item.lastActivityAt ?? 0) > (latest.lastActivityAt ?? 0) ||
          ((item.lastActivityAt ?? 0) === (latest.lastActivityAt ?? 0) && item.id > latest.id) ? item : latest);
      }
    }
    if (!conversation) {
      if (exactCommand) await this.reply(`There is no open conversation. ${NO_TARGET_HELP}`, message);
      else await this.converse(message, parsed.text);
      return;
    }

    store.reference(String(message.timestamp), conversation.id, null);
    // Strictly increasing across conversations: two messages in one millisecond
    // must still leave the later one as the default target.
    conversation.lastActivityAt = Math.max(Date.now(), ...store.all().map((item) => (item.lastActivityAt ?? 0) + 1));
    store.save(conversation);
    if (conversation.status === "cancelling") {
      await this.finishWithdrawal(conversation, message);
      return;
    }
    if (conversation.status === "queued") {
      if (show || bareTargetLink || yesPost || yes) {
        await this.showDraft(conversation, message, "Approved and queued. I’ll submit this exact version when capacity is available.");
        return;
      }
      conversation.status = "cancelling";
      conversation.withdrawDraft = withdraw;
      store.save(conversation);
      if (!await this.finishWithdrawal(conversation, message, withdraw)) return;
      if (withdraw) return;
    }
    if (conversation.status !== "open") {
      const status = conversation.status === "submitted"
        ? conversation.noteId
          ? `Submitted: https://x.com/i/communitynotes/${conversation.noteId}`
          : `A note has already been submitted for this tweet: https://x.com/i/status/${conversation.tweetId}`
        : conversation.status === "uncertain"
          ? "The last submission’s outcome is uncertain. Check X and reconcile it before attempting another submission."
          : "A submission is already in progress.";
      await this.reply(status, message, conversation);
      return;
    }

    if (yesPost || (yes && quoted?.showsDraft)) {
      await this.approve(conversation, message, quoted);
      return;
    }
    // A casual "yes" in the group is never interpreted by an LLM as approval.
    if (yes) {
      await this.reply("To submit, reply to the current draft with ‘yes post’. Otherwise tell me what you’d like to discuss or change.", message, conversation);
      return;
    }
    if (show) {
      await this.showDraft(conversation, message, conversation.inspection?.detail);
      return;
    }
    if (withdraw) {
      conversation.draft = undefined;
      conversation.approval = undefined;
      conversation.submissionRunId = undefined;
      store.save(conversation);
      await this.reply("Draft withdrawn. You can suggest a new correction or source here.", message, conversation);
      return;
    }

    try {
      if (!conversation.inspection?.post) {
        conversation.inspection = await this.dependencies.drafting.inspect(conversation.tweetId);
        store.save(conversation);
        await this.reply(conversation.inspection.detail, message, conversation);
        if (!conversation.inspection.post) return;
      } else if (bareTargetLink && conversation.draft) {
        await this.showDraft(conversation, message, conversation.inspection.detail);
        return;
      }
      this.remember(conversation, "user", parsed.text || `https://x.com/i/web/status/${conversation.tweetId}`);
      const result = await this.dependencies.drafting.draft({
        post: conversation.inspection.post,
        history: conversation.history,
        research: conversation.research,
        currentDraft: conversation.draft,
      });
      if (result.draft) {
        validateSignalDraft(result.draft);
        const previous = conversation.draft;
        const changed = !previous || previous.text !== result.draft.text || JSON.stringify(previous.sources) !== JSON.stringify(result.draft.sources);
        if (changed) conversation.draft = { ...result.draft, version: conversation.nextVersion++, shownAt: 0 };
      } else if (result.abstentionReason) {
        conversation.draft = undefined;
      }
      conversation.research = result.research ?? conversation.research;
      this.remember(conversation, "assistant", result.reply);
      if (result.draft) await this.showDraft(conversation, message, result.reply);
      else await this.reply(result.reply.slice(0, 4500) + (result.abstentionReason ? "\n\nNo draft is ready to submit." : ""), message, conversation);
    } catch (error) {
      this.dependencies.onError?.(error);
      await this.reply("I couldn’t finish that check or revision. No note was submitted. Send ‘retry’ or repeat your request to try again.", message, conversation);
    }
  }

  /** Messages with no tweet to attach to get a plain-language answer about the
   * bot and its conversations. Nothing here can draft, approve, or submit. */
  private async converse(message: ReceivedMessage, text: string): Promise<void> {
    const { store, drafting } = this.dependencies;
    if (!drafting.converse) {
      await this.reply(NO_TARGET_HELP, message);
      return;
    }
    const history = store.generalHistory();
    const summaries: ConversationSummary[] = store.all().slice(-20).map((item) => ({
      id: item.id, tweetId: item.tweetId, status: item.status,
      ...(item.draft ? { draftVersion: item.draft.version, draft: joinNoteWithSources(item.draft.text, item.draft.sources).slice(0, 400) } : {}),
      ...(item.noteId ? { noteId: item.noteId } : {}),
      ...(item.lastActivityAt ? { lastActivityAt: item.lastActivityAt } : {}),
    }));
    let reply: string;
    try {
      reply = await drafting.converse({ text, history: history.slice(-12), conversations: summaries });
    } catch (error) {
      this.dependencies.onError?.(error);
      await this.reply(NO_TARGET_HELP, message);
      return;
    }
    store.saveGeneralHistory([...history, { role: "user" as const, content: text.slice(0, 2_000) }, { role: "assistant" as const, content: reply.slice(0, 2_000) }].slice(-12));
    await this.reply(reply, message);
  }

  private async approve(conversation: Conversation, message: ReceivedMessage, quoted?: MessageReference): Promise<void> {
    const draft = conversation.draft;
    if (!draft) {
      await this.reply("There is no current draft to submit. Suggest a correction and sources first.", message, conversation);
      return;
    }
    if (quoted?.version != null && quoted.version !== draft.version) {
      await this.reply(`That reply refers to v${quoted.version}; the current draft is v${draft.version}. Send ‘draft’ to see it, then approve that version.`, message, conversation);
      return;
    }
    if (!message.approvalReceipt || message.approvalReceipt.conversationId !== conversation.id || message.approvalReceipt.version !== draft.version) {
      await this.reply("That approval arrived before the current draft was shown, or its target changed while waiting. Send ‘draft’ to see it, then reply ‘yes post’.", message, conversation);
      return;
    }
    if (!draft.shownAt || message.timestamp < draft.shownAt) {
      await this.reply("That approval was sent before the current draft was shown. Send ‘draft’ to see it, then reply ‘yes post’.", message, conversation);
      return;
    }
    validateSignalDraft(draft);
    if (this.dependencies.dryRun) {
      await this.reply(`Dry run: ‘yes post’ would submit v${draft.version}. Nothing was sent to X.`, message, conversation);
      return;
    }
    conversation.approval = {
      sender: message.sender,
      timestamp: message.timestamp,
      version: draft.version,
      text: joinNoteWithSources(draft.text, draft.sources),
    };
    conversation.submissionRunId = undefined;
    conversation.lastError = undefined;
    conversation.lastSubmissionResult = undefined;
    this.dependencies.store.enqueueApproval(conversation);
    await this.processQueued(message, conversation.id);
    const queued = this.dependencies.store.get(conversation.id)!;
    if (queued.status === "queued" && !queued.queueNotified) {
      queued.queueNotified = true;
      this.dependencies.store.save(queued);
      await this.reply(`Approved v${draft.version} is queued. I’ll submit this exact version when capacity is available. Say ‘cancel’ to withdraw it.`, message, queued);
    }
  }

  private async finishWithdrawal(conversation: Conversation, message?: IncomingMessage, notify = true): Promise<boolean> {
    try {
      await this.dependencies.cancelSubmission?.(structuredClone(conversation));
    } catch (error) {
      this.dependencies.onError?.(error);
      conversation.lastError = "Could not remove the queued submission. Withdrawal will be retried; no submission will start.";
      this.dependencies.store.save(conversation);
      if (message) await this.reply(conversation.lastError, message, conversation);
      return false;
    }
    const withdrawDraft = conversation.withdrawDraft;
    if (withdrawDraft) conversation.draft = undefined;
    conversation.status = "open";
    conversation.approval = undefined;
    conversation.submissionRunId = undefined;
    conversation.queuedAt = undefined;
    conversation.queueNotified = undefined;
    conversation.withdrawDraft = undefined;
    conversation.sharedQueueCleared = true;
    conversation.lastError = undefined;
    this.dependencies.store.save(conversation);
    if (notify) await this.reply(withdrawDraft
      ? "Queued approval and draft withdrawn. You can suggest a new correction or source here."
      : "Queued approval withdrawn. The draft is saved and needs a new ‘yes post’ before submission.", message, conversation);
    return true;
  }

  private async clearTerminalPriority(conversation: Conversation): Promise<void> {
    try {
      await this.dependencies.cancelSubmission?.(structuredClone(conversation));
      conversation.sharedQueueCleared = true;
      this.dependencies.store.save(conversation);
    } catch (error) {
      this.dependencies.onError?.(error);
    }
  }

  private async attemptSubmission(conversation: Conversation, message?: IncomingMessage): Promise<void> {
    const { draft, approval } = conversation;
    let valid = !!draft && !!approval && draft.version === approval.version &&
      joinNoteWithSources(draft.text, draft.sources) === approval.text;
    try { validateSignalDraft(draft); } catch { valid = false; }
    if (!valid || !draft || !approval) {
      conversation.status = "cancelling";
      conversation.withdrawDraft = false;
      this.dependencies.store.save(conversation);
      if (await this.finishWithdrawal(conversation, message, false)) {
        await this.reply("The saved approval no longer matches the draft, so I withdrew it. Show the draft and approve the current version before submitting.", message, conversation);
      }
      return;
    }
    conversation.lastSubmissionAttemptAt = Date.now();
    this.dependencies.store.save(conversation);
    let result: SubmissionResult;
    try {
      result = await this.dependencies.submit(structuredClone(conversation), {
        onPrepared: runId => {
          conversation.submissionRunId = runId;
          this.dependencies.store.save(conversation);
        },
        onSubmitting: () => {
          if (this.dependencies.store.pendingMessages().length) return false;
          conversation.status = "submitting";
          this.dependencies.store.save(conversation);
          return true;
        },
      });
    } catch (error) {
      this.dependencies.onError?.(error);
      result = conversation.status === "submitting"
        ? { status: "uncertain", message: "Submission interrupted; outcome must be checked before retrying." }
        : { status: "deferred", message: "Could not prepare the queued submission. No X request was started; I’ll retry automatically." };
    }
    await this.applySubmissionResult(conversation, result, message);
  }

  private async applySubmissionResult(conversation: Conversation, result: SubmissionResult, message?: IncomingMessage): Promise<void> {
    conversation.lastSubmissionResult = result;
    conversation.lastError = undefined;
    const version = conversation.approval?.version ?? conversation.draft?.version;
    let response: string;
    if (result.status === "submitted") {
      conversation.status = "submitted";
      conversation.noteId = result.noteId;
      response = `Submitted v${version}: https://x.com/i/communitynotes/${result.noteId}`;
    } else if (result.status === "submission_busy" && result.reason === "submitted") {
      conversation.status = "submitted";
      response = "A note has already been submitted for this tweet. No duplicate was sent.";
    } else if (result.status === "uncertain" || result.status === "submission_busy") {
      conversation.status = "uncertain";
      conversation.lastError = result.status === "uncertain" ? result.message : "An existing submission claim needs reconciliation.";
      response = "I can’t confirm whether X accepted the note. I won’t retry automatically; check X and reconcile the submission first.";
    } else if (result.status === "daily_limit" || result.status === "capacity_reserved" || result.status === "deferred") {
      conversation.status = "queued";
      if (result.status === "deferred") conversation.lastError = result.message;
      response = result.status === "daily_limit"
        ? `X’s writing limit is reached. Approved v${version} is queued for the next available capacity; I’ll retry automatically. Say ‘cancel’ to withdraw it.`
        : `Approved v${version} is queued. I’ll submit this exact version when capacity is available and confirm here. Say ‘cancel’ to withdraw it.`;
    } else {
      conversation.status = "open";
      conversation.approval = undefined;
      response = result.status === "expired"
        ? "X rejected the submission: the tweet was deleted or is not eligible for this account. The draft is saved."
        : `X submission was not completed: ${result.message.slice(0, 300)}. The draft is saved.`;
    }
    const notify = conversation.status !== "queued" || !conversation.queueNotified;
    if (conversation.status === "queued") conversation.queueNotified = true;
    this.dependencies.store.save(conversation);
    if (conversation.status !== "queued") await this.clearTerminalPriority(conversation);
    if (notify) await this.reply(response, message, conversation);
  }
}
