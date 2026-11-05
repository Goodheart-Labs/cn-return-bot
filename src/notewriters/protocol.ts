/* The notewriter protocol (GOO-724): how several AI notewriters share the
 * Common Notes queue. The rules live in the database functions of migration
 * 168, and this file gives them TypeScript types. A notewriter in another
 * language calls the same functions over Supabase's REST layer, as
 * docs/notewriter-protocol.md shows.
 *
 * A notewriter asks for a post whenever it has room for one more. It gets a
 * post, or the time to ask again. It posts its notes, and then finishes the
 * post or fails on it. A failure gives the notewriter a break, and the post
 * goes to the next notewriter. */

import { db } from "../serviceDb";
import type { Json } from "../everything-core/database.types";

export type CaptionCue = { start: number; end: number; text: string };

/** A passage a reader asked about, with the reader's reason. */
export type AskedPassage = { request: string; passage: string; reason: string | null };

export type HandedOutPost = {
  kind: "post";
  assignment: string;
  deadline: string;
  reader_request: boolean;
  item: {
    id: string;
    url: string;
    title: string | null;
    source: string;
    creator: string | null;
    published_at: string | null;
    text: string;
    caption_cues: CaptionCue[] | null;
  };
  asked_passages: AskedPassage[];
  /** True when the post was already checked in full, so only the asked
   *  passages need checking. */
  only_asked_passages: boolean;
};

export type NextPost =
  | HandedOutPost
  | { kind: "wait"; until: string | null; reason: "unsubscribed" | "not_due" | "queue_empty" }
  | { kind: "cooldown"; until: string };

export type NewNote = {
  /** The exact words of the post the note is about. */
  passage: string;
  note: string;
  sources: { url: string; quote?: string; explanation?: string }[];
  /** For a video: where the passage is said. */
  start_seconds?: number | null;
  end_seconds?: number | null;
  context_url?: string | null;
};

export type AddedNote = { kind: "posted"; note: string; claim: string } | { kind: "not_posted"; reason: string };

export type OpenAssignment = {
  assignment: string;
  started_at: string;
  deadline: string;
  reader_request: boolean;
  item: { id: string; url: string; title: string | null };
};

export type NotewriterStatus = {
  notewriter: {
    id: string;
    name: string;
    every_minutes: number | null;
    takes_reader_requests: boolean;
    lease_minutes: number;
    failures_in_a_row: number;
    cooldown_until: string | null;
    last_seen_at: string | null;
  };
  open: OpenAssignment[];
  last_failures: { ended_at: string; outcome: "failed" | "expired"; reason: string; url: string }[];
};

function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export const nextPost = async (notewriter: string) => unwrap<NextPost>(await db().rpc("notewriter_next_post", { p_notewriter: notewriter }));

export const addNote = async (notewriter: string, itemId: string, note: NewNote) =>
  unwrap<AddedNote>(await db().rpc("notewriter_add_note", { p_notewriter: notewriter, p_item: itemId, p_note: note as Json }));

/** Ends an assignment because the notewriter is done with the post. A skip
 *  reason says the post was not worth checking. */
export const finish = async (assignment: string, options: { summary?: Json; skipReason?: string } = {}) =>
  unwrap<{ post: "done" | "back_in_queue" }>(
    await db().rpc("notewriter_finish", { p_assignment: assignment, p_summary: options.summary, p_skip_reason: options.skipReason }),
  );

export const fail = async (assignment: string, reason: string) =>
  unwrap<{ cooldown_until: string; post: "back_in_queue" | "failed" }>(await db().rpc("notewriter_fail", { p_assignment: assignment, p_reason: reason }));

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
