/**
 * What the tag bot does with a tag, with a reply to one of its posts, and with
 * the approvals waiting on a post. Everything it talks to comes in as a
 * dependency, so the tests and the dry run can swap it out.
 *
 * Work on one post runs one task at a time. Two approvals on the same post can
 * then never race each other, and the database's submission lock is the second
 * guarantee that a post gets at most one note.
 */

import type { Post } from "../api/fetchEligiblePosts";
import { TweetLookupError } from "../api/fetchTweetById";
import { pipelineOutcomeOf } from "../bots/types";
import type { NoteRequest } from "../pipeline/input/noteRequest";
import type { TweetComputeOutput } from "../pipeline/orchestration/processTweet";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import type { Revision, TagBotModels } from "./models";
import type { CurrentAnswer, ReplyKind } from "./prompts";
import {
  alreadySubmittedReply, draftReply, gaveUpReply, improvedAndSubmittedReply, improvedQueuedReply, noNoteReply,
  NOT_ON_PATH_REPLY, otherDraftSubmittedReply, queuedReply, refusedReply, submittedReply, UNREADABLE_REPLY,
  type NoteDraft,
} from "./replies";
import type { BotKind, HumanKind, PostRow, TagStore, ThreadRow } from "./store";
import {
  approvedVersion, approversOf, asThreadPosts, currentAnswerAbove, latestAnswer, openApprovals, pathTo, submittedVersion,
} from "./threads";
import type { IncomingPost } from "./x";

/** The bot's chain of steps on the claim-check service, picked from the A/B
 *  tests. A person asked about the post and a person approves the note, so
 *  every gate before and after the writer is off. Research and writing run on
 *  Opus 5.5 at medium reasoning effort. */
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

/** An approval waits this long for room in the daily limit, or for X to take
 *  our notes on the post. */
export const MAX_WAIT_MS = 3 * 60 * 60_000;

type WaitReason = "limit" | "eligibility";

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

  /** Looks at every post whose approvals still wait. main.ts runs this every
   *  two minutes. */
  async tick(): Promise<void> {
    const since = new Date(this.deps.now().getTime() - 2 * MAX_WAIT_MS);
    for (const targetId of await this.deps.store.approvalTargetsSince(since)) {
      await this.onPost(targetId, () => this.settle(targetId));
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
    await this.postDraft(request, targetId, { text: outcome.noteText, sources: outcome.sources });
  }

  /** A second tag on a post the bot already answered gets that answer again,
   *  without new research. If the tag itself asks for a change, it is handled
   *  as feedback on that answer instead. */
  private async answerFromEarlier(request: PostRow, thread: ThreadRow, earlier: PostRow): Promise<void> {
    const { store, models } = this.deps;
    const { postContext, findings, pipelineRunId } = await store.thread(earlier.threadId);
    await store.updateThread(thread.id, { postContext, findings, pipelineRunId });
    const current: CurrentAnswer = earlier.draft ? { kind: "draft", ...earlier.draft } : { kind: "no_note", reply: earlier.text };
    const asks = await models.classify(earlier.text, { handle: request.authorHandle, text: request.text });
    if (asks === "feedback" || asks === "improve_and_approve") {
      return this.answerFeedback(request, { ...thread, postContext, findings }, current);
    }
    if (earlier.draft) return this.postDraft(request, thread.targetTweetId, earlier.draft);
    await this.reply(request, "no_note", earlier.text);
  }

  // ---------------------------------------------------------------------------
  // A reply to one of the bot's posts
  // ---------------------------------------------------------------------------

  private async answerReply(incoming: IncomingPost, parent: PostRow, thread: ThreadRow): Promise<void> {
    const { store, models } = this.deps;
    const stored = await this.storeHuman(incoming, thread.id, parent.tweetId, "other");
    if (!stored) return;
    const kind = onlyDraftsCanBeApproved(await models.classify(parent.text, { handle: incoming.authorHandle, text: incoming.text }), parent);
    await store.setKind(stored.tweetId, kind);
    const reply = { ...stored, kind };
    if (kind === "other") return;
    if (kind === "feedback") return this.answerFeedback(reply, thread);

    const posts = await store.postsOnTarget(thread.targetTweetId);
    if (!approversOf(posts, parent.tweetId).has(reply.authorId)) {
      return void await this.reply(reply, "not_on_path", NOT_ON_PATH_REPLY);
    }
    if (kind === "improve_and_approve") return this.improveAndApprove(reply, thread, posts);
    const waitingFor = await this.settle(thread.targetTweetId);
    if (waitingFor) await this.reply(reply, "queued", queuedReply(waitingFor === "limit"));
  }

  private async answerFeedback(reply: PostRow, thread: ThreadRow, current?: CurrentAnswer): Promise<void> {
    const revision = await this.revise(reply, thread, current);
    if (revision.action === "revise") return this.postDraft(reply, thread.targetTweetId, revision.note, revision.reply);
    await this.reply(reply, "answer", revision.reply);
  }

  /** Revises the draft as asked and submits the new version without another
   *  round of approval. If the revision keeps the draft, nothing is submitted.
   *  The improved version is posted in the one reply to the person, whether it
   *  went in or has to wait. */
  private async improveAndApprove(reply: PostRow, thread: ThreadRow, posts: PostRow[]): Promise<void> {
    const targetId = thread.targetTweetId;
    const noteId = await this.deps.store.noteIdOnPost(targetId);
    if (noteId) return this.answerSubmitted([reply], posts, noteId);
    const revision = await this.revise(reply, thread, undefined, true);
    if (revision.action !== "revise") return void await this.reply(reply, "answer", revision.reply);

    const draft = revision.note;
    const eligible = await this.isEligibleDraft(targetId, draft);
    const result = eligible ? await this.deps.submit(await this.targetPost(targetId), draft) : undefined;
    if (result?.status === "submitted") {
      await this.reply(reply, "submitted", improvedAndSubmittedReply({ lead: revision.reply, draft, noteId: result.noteId }), draft);
      await this.settle(targetId);
      return;
    }
    if (result?.status === "expired" && result.reason === "tweet_deleted") return void await this.reply(reply, "refused", refusedReply("deleted"));
    const stillEligible = eligible && !(result?.status === "expired");
    await this.reply(reply, "queued", improvedQueuedReply({ lead: revision.reply, draft, eligible: stillEligible }), draft);
  }

  // ---------------------------------------------------------------------------
  // Waiting approvals
  // ---------------------------------------------------------------------------

  /**
   * Decides the approvals that wait on a post. The newest one wins: its version
   * is submitted when the daily limit has room and X takes our notes on the
   * post. Every open approval then gets one final reply. Returns why the rest
   * still wait, or null when nothing waits any more.
   */
  private async settle(targetId: string): Promise<WaitReason | null> {
    const { store } = this.deps;
    const posts = await store.postsOnTarget(targetId);
    const { waiting, expired } = openApprovals(posts, this.deps.now(), MAX_WAIT_MS);
    if (waiting.length + expired.length === 0) return null;

    const noteId = await store.noteIdOnPost(targetId);
    if (noteId) {
      await this.answerSubmitted([...waiting, ...expired], posts, noteId);
      return null;
    }
    for (const approval of expired) {
      const eligible = await this.isEligibleDraft(targetId, approvedVersion(posts, approval)!.draft!);
      await this.reply(approval, "gave_up", gaveUpReply(eligible));
    }
    const [newest] = waiting;
    if (!newest) return null;

    const version = approvedVersion(posts, newest)!;
    if (!(await this.isEligibleDraft(targetId, version.draft!))) return "eligibility";
    const result = await this.deps.submit(await this.targetPost(targetId), version.draft!);
    switch (result.status) {
      case "submitted":
        await this.answerSubmitted(waiting, posts, result.noteId, version);
        return null;
      case "expired":
        if (result.reason !== "tweet_deleted") return "eligibility";
        for (const approval of waiting) await this.reply(approval, "refused", refusedReply("deleted"));
        return null;
      case "uncertain":
      case "error":
        console.error(`[x-tag] Submission on ${targetId} failed (${result.status}): ${result.message}`);
        return "limit";
      default:
        return "limit";
    }
  }

  /** The final reply to every approval once the post has our note. The
   *  approvals of the version that went in get "submitted", or "already
   *  submitted" when they came later. The others get the link to the version
   *  that went in. */
  private async answerSubmitted(approvals: PostRow[], posts: PostRow[], noteId: string, justSubmitted?: PostRow): Promise<void> {
    const wentIn = justSubmitted ?? submittedVersion(posts);
    for (const approval of approvals) {
      const version = approvedVersion(posts, approval);
      if (justSubmitted && version?.tweetId === justSubmitted.tweetId) {
        await this.reply(approval, "submitted", submittedReply(noteId));
      } else if (wentIn && version && version.tweetId !== wentIn.tweetId) {
        await this.reply(approval, "other_draft_submitted", otherDraftSubmittedReply({ draftPostId: wentIn.tweetId, noteId }));
      } else {
        await this.reply(approval, "already_submitted", alreadySubmittedReply(noteId));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async revise(reply: PostRow, thread: ThreadRow, current?: CurrentAnswer, improveAndApprove = false): Promise<Revision> {
    const path = pathTo(await this.deps.store.postsOnTarget(thread.targetTweetId), reply.tweetId);
    return this.deps.models.revise({
      postContext: thread.postContext ?? "",
      findings: thread.findings ?? "",
      thread: asThreadPosts(path),
      current: current ?? currentAnswerAbove(path),
      improveAndApprove,
    });
  }

  private async postDraft(parent: PostRow, targetId: string, draft: NoteDraft, lead?: string): Promise<void> {
    const eligible = await this.isEligibleDraft(targetId, draft);
    await this.reply(parent, "draft", draftReply({ draft, eligible, lead }), draft);
  }

  private isEligibleDraft(targetId: string, draft: NoteDraft): Promise<boolean> {
    return this.deps.isEligible(targetId, joinNoteWithSources(draft.text, draft.sources));
  }

  /** The post a note would go on. It is read once and kept, because a waiting
   *  approval needs it on every attempt. */
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

/** Only a post that shows a version of the note can be approved. An approval
 *  of anything else, such as a no-note answer, counts as feedback. */
function onlyDraftsCanBeApproved(kind: ReplyKind, parent: PostRow): ReplyKind {
  return parent.draft || kind === "feedback" || kind === "other" ? kind : "feedback";
}

/** "@CommonNotesBot @someone is this true?" becomes "is this true?". */
export function withoutLeadingMentions(text: string): string {
  return text.replace(/^(\s*@\w+)+/, "").trim();
}
