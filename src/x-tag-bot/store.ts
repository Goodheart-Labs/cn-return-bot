/**
 * Where the bot keeps its tags: one x_tag_requests row per tag (migration 120).
 * The Supabase store is the real one. The memory store backs the tests and the
 * dry run, so a dry run never writes made-up post ids into production tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteDraft } from "./replies";

/** Where a tag stands. "researching" until the bot answers, then the answer:
 *  - "submitted": the note went in, right away or after waiting.
 *  - "waiting": the note is shown and the bot keeps trying to submit it.
 *  - "gave_up": the note still waited after three hours.
 *  - "no_note": the research found nothing to correct.
 *  - "already_submitted": the post already has a note from one of our bots.
 *  - "repeated": the answer links to the bot's earlier answer on the post.
 *  - "unreadable", "deleted": the post can't be read or was deleted. */
export type RequestStatus =
  | "researching" | "submitted" | "waiting" | "gave_up" | "no_note"
  | "already_submitted" | "repeated" | "unreadable" | "deleted";

export interface RequestRow {
  requestTweetId: string;
  targetTweetId: string;
  requesterId: string;
  requesterHandle: string;
  text: string;
  status: RequestStatus;
  /** The bot's reply under the tag. */
  answerTweetId?: string;
  draft?: NoteDraft;
  noteId?: string;
  pipelineRunId?: string;
  createdAt: string;
}

export type NewRequest = Pick<RequestRow, "requestTweetId" | "targetTweetId" | "requesterId" | "requesterHandle" | "text">;
export type RequestUpdate = Partial<Pick<RequestRow, "answerTweetId" | "draft" | "noteId" | "pipelineRunId">> & { status: RequestStatus };

/** An earlier answer on a post that a second tag is pointed to. A note that
 *  gave up, or a post the bot couldn't read, gets new research instead. */
const REPEATABLE: RequestStatus[] = ["submitted", "waiting", "no_note"];

export interface TagStore {
  /** Returns false when the tag is already stored, so a tag the stream
   *  delivers twice is answered once. */
  createRequest(request: NewRequest): Promise<boolean>;
  update(requestTweetId: string, update: RequestUpdate): Promise<void>;
  /** The bot's newest answer on the post that a second tag is pointed to. */
  earlierAnswerOn(targetTweetId: string): Promise<string | null>;
  waiting(): Promise<RequestRow[]>;
  /** Our submitted note on the post, from any of our bots. */
  noteIdOnPost(targetTweetId: string): Promise<string | null>;
}

export function createSupabaseStore(db: SupabaseClient): TagStore {
  const toRequest = (row: any): RequestRow => ({
    requestTweetId: row.request_tweet_id, targetTweetId: row.target_tweet_id,
    requesterId: row.requester_id, requesterHandle: row.requester_handle, text: row.text, status: row.status,
    answerTweetId: row.answer_tweet_id ?? undefined, draft: row.draft ?? undefined, noteId: row.note_id ?? undefined,
    pipelineRunId: row.pipeline_run_id ?? undefined, createdAt: row.created_at,
  });
  const check = <T>({ data, error }: { data: T; error: unknown }): T => {
    if (error) throw error;
    return data;
  };

  return {
    async createRequest(request) {
      const rows = check(await db.from("x_tag_requests").upsert({
        request_tweet_id: request.requestTweetId, target_tweet_id: request.targetTweetId,
        requester_id: request.requesterId, requester_handle: request.requesterHandle, text: request.text,
      }, { onConflict: "request_tweet_id", ignoreDuplicates: true }).select("request_tweet_id"));
      return (rows?.length ?? 0) > 0;
    },
    async update(requestTweetId, update) {
      check(await db.from("x_tag_requests").update({
        status: update.status, answer_tweet_id: update.answerTweetId, draft: update.draft,
        note_id: update.noteId, pipeline_run_id: update.pipelineRunId,
      }).eq("request_tweet_id", requestTweetId));
    },
    async earlierAnswerOn(targetTweetId) {
      const row = check(await db.from("x_tag_requests").select("answer_tweet_id")
        .eq("target_tweet_id", targetTweetId).in("status", REPEATABLE)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()) as { answer_tweet_id: string } | null;
      return row?.answer_tweet_id ?? null;
    },
    async waiting() {
      // A note waits at most three hours, so only a handful are ever waiting.
      return (check(await db.from("x_tag_requests").select().eq("status", "waiting").order("created_at")) ?? []).map(toRequest);
    },
    async noteIdOnPost(targetTweetId) {
      const row = check(await db.from("notes").select("note_id")
        .eq("tweet_id", targetTweetId).not("submitted_at", "is", null).limit(1).maybeSingle()) as { note_id: string } | null;
      return row?.note_id ?? null;
    },
  };
}

export function createMemoryStore(clock: () => Date = () => new Date()): TagStore & { notes: Map<string, string>; requests: Map<string, RequestRow> } {
  const requests = new Map<string, RequestRow>();
  // A counter on top of the clock, so requests stored in the same millisecond
  // keep their order.
  let sequence = 0;
  const stamp = () => new Date(clock().getTime() + sequence++).toISOString();
  const newestFirst = (a: RequestRow, b: RequestRow) => b.createdAt.localeCompare(a.createdAt);

  const store = {
    notes: new Map<string, string>(),
    requests,
    async createRequest(request: NewRequest) {
      if (requests.has(request.requestTweetId)) return false;
      requests.set(request.requestTweetId, { ...request, status: "researching" as const, createdAt: stamp() });
      return true;
    },
    async update(requestTweetId: string, update: RequestUpdate) {
      const defined = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
      requests.set(requestTweetId, { ...requests.get(requestTweetId)!, ...defined });
    },
    async earlierAnswerOn(targetTweetId: string) {
      const earlier = [...requests.values()]
        .filter((r) => r.targetTweetId === targetTweetId && REPEATABLE.includes(r.status)).sort(newestFirst)[0];
      return earlier?.answerTweetId ?? null;
    },
    async waiting() {
      return [...requests.values()].filter((r) => r.status === "waiting").sort(newestFirst).reverse();
    },
    async noteIdOnPost(targetTweetId: string) {
      return store.notes.get(targetTweetId) ?? null;
    },
  };
  return store;
}
