/**
 * What the tag bot does with a tag, with a reply to one of its posts, and with
 * its notes that wait. Everything it talks to comes in as a dependency, so the
 * tests and the dry run can swap it out.
 *
 * The bot submits a note itself as soon as it can. When it can't yet, because
 * X doesn't take our notes on the post or the daily limit is full, it posts the
 * note as waiting, says what would help, and keeps trying for three hours.
 *
 * Work on one post runs one task at a time, so two notes on the same post can
 * never race each other. The database's submission lock is the second
 * guarantee that a post gets at most one note.
 */

import type { Post } from "../api/fetchEligiblePosts";
import { TweetLookupError } from "../api/fetchTweetById";
import { pipelineOutcomeOf } from "../bots/types";
import type { NoteRequest } from "../pipeline/input/noteRequest";
import type { TweetComputeOutput } from "../pipeline/orchestration/processTweet";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import type { TagBotModels } from "./models";
import type { CurrentAnswer } from "./prompts";
import {
  alreadySubmittedReply, gaveUpReply, noNoteReply, otherVersionSubmittedReply, POST_DELETED_REPLY, submittedLaterReply,
  submittedNoteReply, UNREADABLE_REPLY, waitingNoteReply, type NoteDraft, type WaitReason,
} from "./replies";
import type { BotKind, HumanKind, PostRow, TagStore, ThreadRow } from "./store";
import { asThreadPosts, currentAnswerAbove, latestAnswer, openWaitingNotes, pathTo, submittedVersion } from "./threads";
import type { IncomingPost } from "./x";

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
  models: TagBotModels;
  botUserId: string;
  botHandle: string;
  postReply(text: string, inReplyToId: string): Promise<string>;
  fetchPost(postId: string): Promise<Post>;
  checkTweet(post: Post, request: NoteRequest): Promise<TweetComputeOutput>;
  /** Writes the first answer's pipeline_runs row and returns its id. */
  recordRun(post: Post, output: TweetComputeOutput): Promise<string | undefined>;
  isEligible(postId: string, noteText: string): Promise<boolean>;
  submit(post: Post, draft: NoteDraft): Promise<SubmissionResult>;
  now(): Date;
}

export class TagBot {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly targets = new Map<string, Post>();

  constructor(private readonly deps: TagBotDeps) {}

  /** Handles one post from the stream: a tag, or a reply to one of our posts. */
  async receive(incoming: IncomingPost): Promise<void> {
    if (incoming.authorId === this.deps.botUserId) return;
    const parent = incoming.repliedToId ? await this.deps.store.post(incoming.repliedToId) : null;
    if (parent?.role === "bot") {
      const thread = await this.deps.store.thread(parent.threadId);
      return this.onPost(thread.targetTweetId, () => this.answerReply(incoming, parent, thread));
    }
    if (incoming.event !== "mention") return;
    const targetId = incoming.repliedToId ?? incoming.quotedId;
    if (targetId) return this.onPost(targetId, () => this.answerTag(incoming, targetId));
  }

  /** Tries every waiting note again. main.ts runs this every two minutes. */
  async tick(): Promise<void> {
    const since = new Date(this.deps.now().getTime() - 2 * MAX_WAIT_MS);
    for (const targetId of await this.deps.store.waitingTargetsSince(since)) {
      await this.onPost(targetId, () => this.settleWaiting(targetId));
    }
  }

  private onPost<T>(targetId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(targetId) ?? Promise.resolve()).catch(() => {}).then(task);
    this.queues.set(targetId, run);
    return run;
  }

  // ---------------------------------------------------------------------------
  // A tag
  // ---------------------------------------------------------------------------

  private async answerTag(tag: IncomingPost, targetId: string): Promise<void> {
    const { store, models } = this.deps;
    const thread = await store.createThread({
      targetTweetId: targetId, requestTweetId: tag.id, requesterId: tag.authorId, requesterHandle: tag.authorHandle,
    });
    if (!thread) return;
    const request = await this.storeHuman(tag, thread.id, targetId, "request");
    if (!request) return;

    const noteId = await store.noteIdOnPost(targetId);
    if (noteId) return void await this.reply(request, "already_submitted", alreadySubmittedReply(noteId));
    const earlier = latestAnswer(await store.postsOnTarget(targetId));
    if (earlier) return this.answerFromEarlier(request, thread, earlier);

    let post: Post;
    try {
      post = await this.targetPost(targetId);
    } catch (error) {
      if (error instanceof TweetLookupError) return void await this.reply(request, "unreadable", UNREADABLE_REPLY);
      throw error;
    }
    if (post.author_id === this.deps.botUserId) return;

    const output = await this.deps.checkTweet(post, { handle: tag.authorHandle, text: withoutLeadingMentions(tag.text) });
    const outcome = pipelineOutcomeOf(output);
    const postContext = output.postContext ?? "";
    const findings = outcome.searchResults ?? "";
    await store.updateThread(thread.id, { postContext, findings, pipelineRunId: await this.deps.recordRun(post, output) });
    if (outcome.type === "no_correction") {
      return void await this.reply(request, "no_note", noNoteReply(await models.writeNoNoteReply(postContext, findings)));
    }
    await this.publishNote(request, targetId, { text: outcome.noteText, sources: outcome.sources });
  }

  /** A second tag on a post the bot already answered gets that answer again,
   *  without new research. If the tag itself asks for a change, it is handled
   *  as feedback on that answer instead. */
  private async answerFromEarlier(request: PostRow, thread: ThreadRow, earlier: PostRow): Promise<void> {
    const { store, models } = this.deps;
    const { postContext, findings, pipelineRunId } = await store.thread(earlier.threadId);
    await store.updateThread(thread.id, { postContext, findings, pipelineRunId });
    const current: CurrentAnswer = earlier.draft ? { kind: "note", ...earlier.draft } : { kind: "no_note", reply: earlier.text };
    if (await models.classify(earlier.text, { handle: request.authorHandle, text: request.text }) === "feedback") {
      return this.answerFeedback(request, { ...thread, postContext, findings }, current);
    }
    if (earlier.draft) return this.publishNote(request, thread.targetTweetId, earlier.draft);
    await this.reply(request, "no_note", earlier.text);
  }

  // ---------------------------------------------------------------------------
  // A reply to one of the bot's posts
  // ---------------------------------------------------------------------------

  private async answerReply(incoming: IncomingPost, parent: PostRow, thread: ThreadRow): Promise<void> {
    const { store, models } = this.deps;
    const stored = await this.storeHuman(incoming, thread.id, parent.tweetId, "other");
    if (!stored) return;
    const kind = await models.classify(parent.text, { handle: incoming.authorHandle, text: incoming.text });
    await store.setKind(stored.tweetId, kind);
    if (kind === "other") return;
    const noteId = await store.noteIdOnPost(thread.targetTweetId);
    if (noteId) return void await this.reply(stored, "already_submitted", alreadySubmittedReply(noteId));
    await this.answerFeedback({ ...stored, kind }, thread);
  }

  /** Revises the answer if the evidence supports the feedback. A revised note
   *  is published like a first one. A withdrawal is a no-note answer, so a
   *  waiting note above it stops being tried. */
  private async answerFeedback(reply: PostRow, thread: ThreadRow, current?: CurrentAnswer): Promise<void> {
    const path = pathTo(await this.deps.store.postsOnTarget(thread.targetTweetId), reply.tweetId);
    const revision = await this.deps.models.revise({
      postContext: thread.postContext ?? "",
      findings: thread.findings ?? "",
      thread: asThreadPosts(path),
      current: current ?? currentAnswerAbove(path),
    });
    if (revision.action === "revise") return this.publishNote(reply, thread.targetTweetId, revision.note, revision.reply);
    await this.reply(reply, revision.action === "withdraw" ? "no_note" : "answer", revision.reply);
  }

  // ---------------------------------------------------------------------------
  // Submitting
  // ---------------------------------------------------------------------------

  /** Submits a note right away if it can, and otherwise posts it as waiting.
   *  Either way the person gets one reply, which shows the note. */
  private async publishNote(parent: PostRow, targetId: string, draft: NoteDraft, lead?: string): Promise<void> {
    const olderVersions = openWaitingNotes(await this.deps.store.postsOnTarget(targetId));
    const attempt = await this.trySubmit(targetId, draft);
    if (attempt.kind === "deleted") return void await this.reply(parent, "refused", POST_DELETED_REPLY);
    if (attempt.kind === "waiting") {
      return void await this.reply(parent, "waiting", waitingNoteReply({ draft, reason: attempt.reason, lead }), draft);
    }
    const submitted = await this.reply(parent, "submitted", submittedNoteReply({ draft, noteId: attempt.noteId, lead }), draft);
    await this.answerSubmitted(olderVersions, attempt.noteId, submitted);
  }

  /** Tries the newest waiting note on a post again. Once the post has its note,
   *  or the newest waiting note waited three hours, every waiting note on the
   *  post gets its final reply. */
  private async settleWaiting(targetId: string): Promise<void> {
    const posts = await this.deps.store.postsOnTarget(targetId);
    const waiting = openWaitingNotes(posts);
    const [newest] = waiting;
    if (!newest) return;

    const noteId = await this.deps.store.noteIdOnPost(targetId);
    if (noteId) return this.answerSubmitted(waiting, noteId, submittedVersion(posts));
    if (this.deps.now().getTime() - new Date(newest.createdAt).getTime() > MAX_WAIT_MS) {
      const reason: WaitReason = (await this.isEligibleDraft(targetId, newest.draft!)) ? "limit" : "eligibility";
      for (const note of waiting) await this.reply(note, "gave_up", gaveUpReply(reason));
      return;
    }
    const attempt = await this.trySubmit(targetId, newest.draft!);
    if (attempt.kind === "submitted") return this.answerSubmitted(waiting, attempt.noteId, newest);
    if (attempt.kind === "deleted") for (const note of waiting) await this.reply(note, "refused", POST_DELETED_REPLY);
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

  /** The final reply under each waiting note once the post has our note. The
   *  version that went in gets "submitted". The others get the link to it, or,
   *  when another of our bots submitted the note, its link. */
  private async answerSubmitted(waiting: PostRow[], noteId: string, wentIn?: PostRow): Promise<void> {
    for (const note of waiting) {
      if (note.tweetId === wentIn?.tweetId) await this.reply(note, "submitted", submittedLaterReply(noteId));
      else if (wentIn) await this.reply(note, "other_version_submitted", otherVersionSubmittedReply({ versionPostId: wentIn.tweetId, noteId }));
      else await this.reply(note, "already_submitted", alreadySubmittedReply(noteId));
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  private async storeHuman(incoming: IncomingPost, threadId: string, parentTweetId: string, kind: HumanKind): Promise<PostRow | null> {
    const row = {
      tweetId: incoming.id, threadId, parentTweetId, authorId: incoming.authorId, authorHandle: incoming.authorHandle,
      role: "human" as const, kind, text: incoming.text,
    };
    return (await this.deps.store.addPost(row)) ? { ...row, createdAt: this.deps.now().toISOString() } : null;
  }

  private async reply(parent: PostRow, kind: BotKind, text: string, draft?: NoteDraft): Promise<PostRow> {
    const tweetId = await this.deps.postReply(text, parent.tweetId);
    const row = {
      tweetId, threadId: parent.threadId, parentTweetId: parent.tweetId,
      authorId: this.deps.botUserId, authorHandle: this.deps.botHandle, role: "bot" as const, kind, text, draft,
    };
    await this.deps.store.addPost(row);
    return { ...row, createdAt: this.deps.now().toISOString() };
  }
}

/** "@CommonNotesBot @someone is this true?" becomes "is this true?". */
export function withoutLeadingMentions(text: string): string {
  return text.replace(/^(\s*@\w+)+/, "").trim();
}
