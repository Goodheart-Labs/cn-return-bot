/**
 * What the tag bot does with a tag and with its notes that wait. Everything it
 * talks to comes in as a dependency, so the tests and the dry run can swap it
 * out.
 *
 * A tag gets one answer: a note, or the reason no note is needed. The bot
 * submits the note itself as soon as it can. When it can't yet, because X
 * doesn't take our notes on the post or the daily limit is full, it says so,
 * says what would help, and keeps trying for three hours.
 *
 * Work on one post runs one task at a time, so a second tag on the same post
 * sees the first answer instead of starting a second note.
 */

import type { Post } from "../api/fetchEligiblePosts";
import { TweetLookupError } from "../api/fetchTweetById";
import { pipelineOutcomeOf } from "../bots/types";
import type { NoteRequest } from "../pipeline/input/noteRequest";
import type { TweetComputeOutput } from "../pipeline/orchestration/processTweet";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import {
  alreadySubmittedReply, earlierAnswerReply, gaveUpReply, POST_DELETED_REPLY, submittedLaterReply, submittedNoteReply,
  UNREADABLE_REPLY, waitingNoteReply, type NoteDraft, type WaitReason,
} from "./replies";
import type { RequestRow, RequestUpdate, TagStore } from "./store";
import type { Tag } from "./x";

/** The bot's chain of steps on the claim-check service, picked from the A/B
 *  tests. A person asked about the post, so every gate before and after the
 *  writer is off. Research and writing run on Opus 5.5 at medium reasoning. */
export const TAG_BOT_PICKS: Record<string, string> = {
  bot: "simple-bot",
  topic_filter: "off",
  note_prefilter: "off",
  simple_bot_search: "opus55-native-medium",
  simple_bot_writer: "opus55-medium",
  simple_bot_verifier: "off",
  materiality_treatment: "off",
  eval_submit_threshold: "off",
};

/** A waiting note is tried for this long. */
export const MAX_WAIT_MS = 3 * 60 * 60_000;

/** The outcome of one attempt to submit a note. */
type Attempt = { kind: "submitted"; noteId: string } | { kind: "waiting"; reason: WaitReason } | { kind: "deleted" };

export interface TagBotDeps {
  store: TagStore;
  botUserId: string;
  postReply(text: string, inReplyToId: string): Promise<string>;
  fetchPost(postId: string): Promise<Post>;
  checkTweet(post: Post, request: NoteRequest): Promise<TweetComputeOutput>;
  /** Writes the answer's pipeline_runs row and returns its id. */
  recordRun(post: Post, output: TweetComputeOutput): Promise<string | undefined>;
  writeNoNoteReply(postContext: string, findings: string): Promise<string>;
  isEligible(postId: string, noteText: string): Promise<boolean>;
  submit(post: Post, draft: NoteDraft): Promise<SubmissionResult>;
  now(): Date;
}

export class TagBot {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly targets = new Map<string, Post>();

  constructor(private readonly deps: TagBotDeps) {}

  /** Handles one tag from the stream. A reply to one of the bot's own posts
   *  also mentions the bot, but it is not a tag, so it is ignored. */
  async receive(tag: Tag): Promise<void> {
    if (tag.authorId === this.deps.botUserId || tag.repliedToUserId === this.deps.botUserId) return;
    const targetId = tag.repliedToId ?? tag.quotedId;
    if (targetId) return this.onPost(targetId, () => this.answerTag(tag, targetId));
  }

  /** Tries every waiting note again. main.ts runs this every two minutes. */
  async tick(): Promise<void> {
    for (const request of await this.deps.store.waiting()) {
      await this.onPost(request.targetTweetId, () => this.retry(request));
    }
  }

  private onPost<T>(targetId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(targetId) ?? Promise.resolve()).catch(() => {}).then(task);
    this.queues.set(targetId, run);
    return run;
  }

  private async answerTag(tag: Tag, targetId: string): Promise<void> {
    const { store } = this.deps;
    const isNew = await store.createRequest({
      requestTweetId: tag.id, targetTweetId: targetId, requesterId: tag.authorId, requesterHandle: tag.authorHandle, text: tag.text,
    });
    if (!isNew) return;

    const noteId = await store.noteIdOnPost(targetId);
    if (noteId) return this.answer(tag.id, { status: "already_submitted", noteId }, alreadySubmittedReply(noteId));
    const earlierAnswerId = await store.earlierAnswerOn(targetId);
    if (earlierAnswerId) return this.answer(tag.id, { status: "repeated" }, earlierAnswerReply(earlierAnswerId));

    let post: Post;
    try {
      post = await this.targetPost(targetId);
    } catch (error) {
      if (error instanceof TweetLookupError) return this.answer(tag.id, { status: "unreadable" }, UNREADABLE_REPLY);
      throw error;
    }
    if (post.author_id === this.deps.botUserId) return;

    const output = await this.deps.checkTweet(post, { handle: tag.authorHandle, text: withoutLeadingMentions(tag.text) });
    const outcome = pipelineOutcomeOf(output);
    const pipelineRunId = await this.deps.recordRun(post, output);
    if (outcome.type === "no_correction") {
      const reply = await this.deps.writeNoNoteReply(output.postContext ?? "", outcome.searchResults ?? "");
      return this.answer(tag.id, { status: "no_note", pipelineRunId }, reply);
    }

    const draft = { text: outcome.noteText, sources: outcome.sources };
    const attempt = await this.trySubmit(targetId, draft);
    if (attempt.kind === "deleted") return this.answer(tag.id, { status: "deleted", pipelineRunId, draft }, POST_DELETED_REPLY);
    if (attempt.kind === "waiting") {
      return this.answer(tag.id, { status: "waiting", pipelineRunId, draft }, waitingNoteReply(draft, attempt.reason));
    }
    await this.answer(tag.id, { status: "submitted", pipelineRunId, draft, noteId: attempt.noteId }, submittedNoteReply(draft, attempt.noteId));
  }

  /** Tries a waiting note again. Once it is settled, the bot replies under its
   *  own answer: the note went in, another of our bots noted the post, the post
   *  is gone, or three hours have passed. */
  private async retry(request: RequestRow): Promise<void> {
    const { store } = this.deps;
    const draft = request.draft!;
    const settle = async (update: RequestUpdate, text: string) => {
      await this.deps.postReply(text, request.answerTweetId!);
      await store.update(request.requestTweetId, update);
    };

    const noteId = await store.noteIdOnPost(request.targetTweetId);
    if (noteId) return settle({ status: "already_submitted", noteId }, alreadySubmittedReply(noteId));
    if (this.deps.now().getTime() - new Date(request.createdAt).getTime() > MAX_WAIT_MS) {
      const reason: WaitReason = (await this.isEligibleDraft(request.targetTweetId, draft)) ? "limit" : "eligibility";
      return settle({ status: "gave_up" }, gaveUpReply(reason));
    }
    const attempt = await this.trySubmit(request.targetTweetId, draft);
    if (attempt.kind === "submitted") return settle({ status: "submitted", noteId: attempt.noteId }, submittedLaterReply(attempt.noteId));
    if (attempt.kind === "deleted") return settle({ status: "deleted" }, POST_DELETED_REPLY);
  }

  /** One attempt: X must take our notes on the post, and the daily limit must
   *  have room. */
  private async trySubmit(targetId: string, draft: NoteDraft): Promise<Attempt> {
    if (!(await this.isEligibleDraft(targetId, draft))) return { kind: "waiting", reason: "eligibility" };
    const result = await this.deps.submit(await this.targetPost(targetId), draft);
    switch (result.status) {
      case "submitted":
        return { kind: "submitted", noteId: result.noteId };
      case "expired":
        return result.reason === "tweet_deleted" ? { kind: "deleted" } : { kind: "waiting", reason: "eligibility" };
      case "uncertain":
      case "error":
        console.error(`[x-tag] Submission on ${targetId} failed (${result.status}): ${result.message}`);
        return { kind: "waiting", reason: "limit" };
      default:
        return { kind: "waiting", reason: "limit" };
    }
  }

  private isEligibleDraft(targetId: string, draft: NoteDraft): Promise<boolean> {
    return this.deps.isEligible(targetId, joinNoteWithSources(draft.text, draft.sources));
  }

  /** The post a note would go on. It is read once and kept, because a waiting
   *  note needs it on every attempt. */
  private async targetPost(targetId: string): Promise<Post> {
    const cached = this.targets.get(targetId);
    if (cached) return cached;
    const post = await this.deps.fetchPost(targetId);
    this.targets.set(targetId, post);
    return post;
  }

  /** Replies under the tag and stores what the answer was. */
  private async answer(requestTweetId: string, update: RequestUpdate, text: string): Promise<void> {
    const answerTweetId = await this.deps.postReply(text, requestTweetId);
    await this.deps.store.update(requestTweetId, { ...update, answerTweetId });
  }
}

/** "@community_notes @someone is this true?" becomes "is this true?". */
export function withoutLeadingMentions(text: string): string {
  return text.replace(/^(\s*@\w+)+/, "").trim();
}
