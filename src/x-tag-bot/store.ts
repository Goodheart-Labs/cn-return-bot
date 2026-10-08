/**
 * Where the bot keeps its conversations: x_tag_threads and x_tag_posts
 * (migration 120). The Supabase store is the real one. The memory store backs
 * the tests and the dry run, so a dry run never writes made-up post ids into
 * production tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplyKind } from "./prompts";
import type { NoteDraft } from "./replies";

export type HumanKind = "request" | ReplyKind;
export type BotKind =
  | "waiting" | "submitted" | "no_note" | "answer" | "other_version_submitted"
  | "already_submitted" | "gave_up" | "refused" | "unreadable";

export interface ThreadRow {
  id: string;
  targetTweetId: string;
  requestTweetId: string;
  requesterId: string;
  requesterHandle: string;
  postContext?: string;
  findings?: string;
  pipelineRunId?: string;
  createdAt: string;
}

export interface PostRow {
  tweetId: string;
  threadId: string;
  parentTweetId: string | null;
  authorId: string;
  authorHandle: string;
  role: "human" | "bot";
  kind: HumanKind | BotKind;
  text: string;
  /** Set on every bot post that shows a note: a waiting note, and a note that
   *  went in with the first reply. */
  draft?: NoteDraft;
  createdAt: string;
}

export type NewThread = Omit<ThreadRow, "id" | "createdAt">;
export type NewPost = Omit<PostRow, "createdAt">;

export interface TagStore {
  /** Returns null when the request post already has a thread. */
  createThread(thread: NewThread): Promise<ThreadRow | null>;
  updateThread(id: string, fields: Pick<ThreadRow, "postContext" | "findings" | "pipelineRunId">): Promise<void>;
  thread(id: string): Promise<ThreadRow>;
  /** Returns false when the post is already stored. */
  addPost(post: NewPost): Promise<boolean>;
  setKind(tweetId: string, kind: HumanKind): Promise<void>;
  post(tweetId: string): Promise<PostRow | null>;
  threadsOnTarget(targetTweetId: string): Promise<ThreadRow[]>;
  /** Every post of every thread on the target, oldest first. */
  postsOnTarget(targetTweetId: string): Promise<PostRow[]>;
  /** The targets with a waiting note posted since the given time. */
  waitingTargetsSince(since: Date): Promise<string[]>;
  /** Our submitted note on the post, from any of our bots. */
  noteIdOnPost(targetTweetId: string): Promise<string | null>;
}


export function createSupabaseStore(db: SupabaseClient): TagStore {
  const toThread = (row: any): ThreadRow => ({
    id: row.id, targetTweetId: row.target_tweet_id, requestTweetId: row.request_tweet_id,
    requesterId: row.requester_id, requesterHandle: row.requester_handle,
    postContext: row.post_context ?? undefined, findings: row.findings ?? undefined,
    pipelineRunId: row.pipeline_run_id ?? undefined, createdAt: row.created_at,
  });
  const toPost = (row: any): PostRow => ({
    tweetId: row.tweet_id, threadId: row.thread_id, parentTweetId: row.parent_tweet_id,
    authorId: row.author_id, authorHandle: row.author_handle, role: row.role, kind: row.kind,
    text: row.text, draft: row.draft ?? undefined, createdAt: row.created_at,
  });
  const check = <T>({ data, error }: { data: T; error: unknown }): T => {
    if (error) throw error;
    return data;
  };

  return {
    async createThread(thread) {
      const rows = check(await db.from("x_tag_threads").upsert({
        target_tweet_id: thread.targetTweetId, request_tweet_id: thread.requestTweetId,
        requester_id: thread.requesterId, requester_handle: thread.requesterHandle,
      }, { onConflict: "request_tweet_id", ignoreDuplicates: true }).select());
      return rows?.[0] ? toThread(rows[0]) : null;
    },
    async updateThread(id, fields) {
      check(await db.from("x_tag_threads").update({
        post_context: fields.postContext, findings: fields.findings, pipeline_run_id: fields.pipelineRunId,
      }).eq("id", id));
    },
    async thread(id) {
      return toThread(check(await db.from("x_tag_threads").select().eq("id", id).single()));
    },
    async addPost(post) {
      const rows = check(await db.from("x_tag_posts").upsert({
        tweet_id: post.tweetId, thread_id: post.threadId, parent_tweet_id: post.parentTweetId,
        author_id: post.authorId, author_handle: post.authorHandle, role: post.role, kind: post.kind,
        text: post.text, draft: post.draft ?? null,
      }, { onConflict: "tweet_id", ignoreDuplicates: true }).select("tweet_id"));
      return (rows?.length ?? 0) > 0;
    },
    async setKind(tweetId, kind) {
      check(await db.from("x_tag_posts").update({ kind }).eq("tweet_id", tweetId));
    },
    async post(tweetId) {
      const row = check(await db.from("x_tag_posts").select().eq("tweet_id", tweetId).maybeSingle());
      return row ? toPost(row) : null;
    },
    async threadsOnTarget(targetTweetId) {
      // A post gets a handful of threads at most, so one request is enough.
      return (check(await db.from("x_tag_threads").select().eq("target_tweet_id", targetTweetId)) ?? []).map(toThread);
    },
    async postsOnTarget(targetTweetId) {
      const threadIds = (await this.threadsOnTarget(targetTweetId)).map((thread) => thread.id);
      if (threadIds.length === 0) return [];
      const rows = check(await db.from("x_tag_posts").select().in("thread_id", threadIds).order("created_at"));
      return (rows ?? []).map(toPost);
    },
    async waitingTargetsSince(since) {
      const rows = check(await db.from("x_tag_posts")
        .select("x_tag_threads!inner(target_tweet_id)")
        .eq("kind", "waiting")
        .gte("created_at", since.toISOString())) as any[] | null;
      return [...new Set((rows ?? []).map((row) => row.x_tag_threads.target_tweet_id as string))];
    },
    async noteIdOnPost(targetTweetId) {
      const row = check(await db.from("notes").select("note_id")
        .eq("tweet_id", targetTweetId).not("submitted_at", "is", null).limit(1).maybeSingle()) as { note_id: string } | null;
      return row?.note_id ?? null;
    },
  };
}

export function createMemoryStore(clock: () => Date = () => new Date()): TagStore & { notes: Map<string, string> } {
  const threads = new Map<string, ThreadRow>();
  const posts = new Map<string, PostRow>();
  // A counter on top of the clock, so posts written in the same millisecond
  // keep their order.
  let sequence = 0;
  const stamp = () => new Date(clock().getTime() + sequence++).toISOString();

  const store = {
    notes: new Map<string, string>(),
    async createThread(thread: NewThread) {
      if ([...threads.values()].some((t) => t.requestTweetId === thread.requestTweetId)) return null;
      const row = { ...thread, id: `thread-${threads.size + 1}`, createdAt: stamp() };
      threads.set(row.id, row);
      return row;
    },
    async updateThread(id: string, fields: Pick<ThreadRow, "postContext" | "findings" | "pipelineRunId">) {
      threads.set(id, { ...threads.get(id)!, ...fields });
    },
    async thread(id: string) {
      return threads.get(id)!;
    },
    async addPost(post: NewPost) {
      if (posts.has(post.tweetId)) return false;
      posts.set(post.tweetId, { ...post, createdAt: stamp() });
      return true;
    },
    async setKind(tweetId: string, kind: HumanKind) {
      posts.set(tweetId, { ...posts.get(tweetId)!, kind });
    },
    async post(tweetId: string) {
      return posts.get(tweetId) ?? null;
    },
    async threadsOnTarget(targetTweetId: string) {
      return [...threads.values()].filter((t) => t.targetTweetId === targetTweetId);
    },
    async postsOnTarget(targetTweetId: string) {
      const ids = new Set((await store.threadsOnTarget(targetTweetId)).map((t) => t.id));
      return [...posts.values()].filter((p) => ids.has(p.threadId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async waitingTargetsSince(since: Date) {
      const targets = [...posts.values()]
        .filter((p) => p.kind === "waiting" && new Date(p.createdAt) >= since)
        .map((p) => threads.get(p.threadId)!.targetTweetId);
      return [...new Set(targets)];
    },
    async noteIdOnPost(targetTweetId: string) {
      return store.notes.get(targetTweetId) ?? null;
    },
  };
  return store;
}
