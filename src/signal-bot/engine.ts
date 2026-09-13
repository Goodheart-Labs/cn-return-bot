import type { DraftingAdapter } from "./drafting";
import { validateSignalDraft } from "./drafting";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import type { IncomingMessage } from "./transport";
import { SignalStore, type Conversation, type MessageReference, type ReceivedMessage } from "./store";

interface EngineDependencies {
  store: SignalStore;
  drafting: DraftingAdapter;
  send: (text: string, quote?: IncomingMessage) => Promise<string>;
  submit: (conversation: Conversation) => Promise<SubmissionResult>;
  dryRun?: boolean;
  onError?: (error: unknown) => void;
}

const MAX_INPUT_CHARS = 6000;
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
    return this.drain();
  }

  drain(): Promise<void> {
    return this.queue;
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

  private async reply(text: string, message: IncomingMessage, conversation?: Conversation, showsDraft = false): Promise<void> {
    const body = conversation ? `#${conversation.id} · ${conversation.tweetId}\n${text}` : text;
    this.dependencies.store.recordBotOutput(body);
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
    await this.reply(`${intro}Proposed note · v${draft.version}\n\n${note}\n\nDiscuss or suggest changes. Reply ‘yes post’ to submit this version.`, message, conversation, true);
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
    if (parsed.threadId !== undefined && (!Number.isSafeInteger(parsed.threadId) || parsed.threadId < 1)) {
      await this.reply("Use the conversation number shown above the draft, such as #1.", message);
      return;
    }
    const quoted = message.quoteId ? store.resolve(message.quoteId) : undefined;
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
    if (!conversation) {
      const open = store.all().filter((item) => item.status === "open");
      if (open.length === 1) conversation = open[0];
    }
    if (!conversation) {
      await this.reply("Paste a tweet link to get an access check and draft. For an existing tweet, reply to its draft or start your message with its #number.", message);
      return;
    }

    store.reference(String(message.timestamp), conversation.id, null);
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

    const yesPost = /^yes(?:\s*,\s*|\s+)post(?:\s+it)?[.!]?$/i.test(parsed.text);
    const yes = /^yes[.!]?$/i.test(parsed.text);
    if (yesPost || (yes && quoted?.showsDraft)) {
      await this.approve(conversation, message, quoted);
      return;
    }
    // A casual "yes" in the group is never interpreted by an LLM as approval.
    if (yes) {
      await this.reply("To submit, reply to the current draft with ‘yes post’. Otherwise tell me what you’d like to discuss or change.", message, conversation);
      return;
    }
    if (/^(?:status|draft|show draft)[.!]?$/i.test(parsed.text)) {
      await this.showDraft(conversation, message, conversation.inspection?.detail);
      return;
    }
    if (/^(?:cancel|withdraw)[.!]?$/i.test(parsed.text)) {
      conversation.draft = undefined;
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
    conversation.status = "submitting";
    this.dependencies.store.save(conversation);
    let response: string;
    try {
      const result = await this.dependencies.submit(structuredClone(conversation));
      if (result.status === "submitted") {
        conversation.status = "submitted";
        conversation.noteId = result.noteId;
        response = `Submitted v${draft.version}: https://x.com/i/communitynotes/${result.noteId}`;
      } else if (result.status === "submission_busy" && result.reason === "submitted") {
        conversation.status = "submitted";
        response = "A note has already been submitted for this tweet. No duplicate was sent.";
      } else if (result.status === "uncertain" || result.status === "submission_busy") {
        conversation.status = "uncertain";
        conversation.lastError = result.status === "uncertain" ? result.message : "An existing submission claim needs reconciliation.";
        response = "I can’t confirm whether X accepted the note. I won’t retry automatically; check X and reconcile the submission first.";
      } else {
        conversation.status = "open";
        response = result.status === "daily_limit"
          ? "X rejected the submission because the writing limit is reached. The draft is saved; say ‘yes post’ again when capacity returns."
          : result.status === "capacity_reserved"
            ? "No submission capacity is available. The draft is saved."
            : result.status === "expired"
              ? "X rejected the submission: the tweet was deleted or is not eligible for this account. The draft is saved."
              : `X submission was not completed: ${result.message.slice(0, 300)}. The draft is saved.`;
      }
    } catch (error) {
      this.dependencies.onError?.(error);
      conversation.status = "uncertain";
      conversation.lastError = "Submission interrupted; outcome must be checked before retrying.";
      response = "The submission was interrupted, so its outcome is uncertain. Check X before trying again; I won’t retry automatically.";
    }
    this.dependencies.store.save(conversation);
    // A failed Signal reply must never change an accepted X submission back to
    // open or trigger another X request.
    await this.reply(response, message, conversation);
  }
}
