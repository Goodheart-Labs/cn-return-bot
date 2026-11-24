/* API v1 of the notewriters: the protocol of migration 168, which the Claude
 * runners on Nathan's ai-box and hq and the pipeline call. Since migration 184
 * (GOO-791) its six database functions sit on top of the reservations of API
 * v2 (client.ts), with the same names, arguments and answers. Two answers
 * changed: next_post never answers a break, because there are none, and
 * add_note fails unless the notewriter holds the post.
 *
 * v1 names the notewriter in each call and needs the secret key, so only our
 * own notewriters use it. A notewriter asks for a post whenever it has room
 * for one more, posts its notes, and then finishes the post or fails on it. */

import { db } from "../serviceDb";
import type { Json } from "../everything-core/database.types";
import type { AskedPassage, NewNote, Post } from "./client";

export type HandedOutPost = {
  kind: "post";
  assignment: string;
  deadline: string;
  reader_request: boolean;
  item: Omit<Post, "requested" | "asked_passages" | "only_asked_passages">;
  asked_passages: AskedPassage[];
  /** True when the post was already checked in full, so only the asked
   *  passages need checking. */
  only_asked_passages: boolean;
};

export type NextPost =
  | HandedOutPost
  | { kind: "wait"; until: string; reason: "not_due" | "queue_empty" }
  | { kind: "wait"; until: null; reason: "unsubscribed" };

/** For the pipeline: the claim of the post the note hangs on. */
export type V1Note = NewNote & { context_url?: string | null; claim?: string };

export type AddedNote = { kind: "posted"; note: string; claim: string } | { kind: "not_posted"; reason: string };

export type OpenAssignment = {
  assignment: string;
  started_at: string;
  deadline: string;
  reader_request: boolean;
  item: { id: string; url: string; title: string | null };
};

export type NotewriterStatus = {
  notewriter: { id: string; name: string; every_minutes: number | null; takes_reader_requests: boolean; lease_minutes: number; last_seen_at: string | null };
  open: OpenAssignment[];
  last_failures: { ended_at: string; outcome: "failed" | "expired"; reason: string; url: string }[];
};

function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export const nextPost = async (notewriter: string) => unwrap<NextPost>(await db().rpc("notewriter_next_post", { p_notewriter: notewriter }));

export const addNote = async (notewriter: string, itemId: string, note: V1Note) =>
  unwrap<AddedNote>(await db().rpc("notewriter_add_note", { p_notewriter: notewriter, p_item: itemId, p_note: note as Json }));

/** Ends an assignment because the notewriter is done with the post. A skip
 *  reason says the post was not worth checking. */
export const finish = async (assignment: string, options: { summary?: Json; skipReason?: string } = {}) =>
  unwrap<{ post: "done" | "back_in_queue" }>(
    await db().rpc("notewriter_finish", { p_assignment: assignment, p_summary: options.summary, p_skip_reason: options.skipReason }),
  );

/** `failed` means the post was requested and no notewriter that takes reader
 *  requests is left for it. */
export const fail = async (assignment: string, reason: string) =>
  unwrap<{ post: "back_in_queue" | "failed" }>(await db().rpc("notewriter_fail", { p_assignment: assignment, p_reason: reason }));

/** Sets how often the notewriter wants a feed post, null for none, and
 *  whether it takes reader requests, which are never paced. */
export const subscribe = async (notewriter: string, everyMinutes: number | null, takesReaderRequests?: boolean) =>
  unwrap<{ every_minutes: number | null; takes_reader_requests: boolean }>(
    await db().rpc("notewriter_subscribe", {
      p_notewriter: notewriter,
      // The database takes null for "no feed posts", which the generated
      // types do not know.
      p_every_minutes: everyMinutes as number,
      p_takes_reader_requests: takesReaderRequests,
    }),
  );

export const status = async (notewriter: string) => unwrap<NotewriterStatus>(await db().rpc("notewriter_status", { p_notewriter: notewriter }));
