import "dotenv/config";
import { mkdir } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../api/supabaseClient";
import type { TypefullyDraftState } from "../everything-core/xMarks";
import { closeBrowser, takeNoteImage } from "./noteImage";
import { createDraft, draftStates } from "./typefully";

/* The posting worker (migration 173): what makes the review page's Post on X
 * button work on commonnotes.net. An admin's press writes a request into
 * everything_x_post_requests. This worker runs on the team's server, with the
 * service key and the Typefully key. For each pending request it takes a
 * picture of the note's card from commonnotes.net/note-image/<note>, creates
 * a Typefully draft in the next free slot of the account's queue, marks the
 * note as scheduled on X and closes the request. Every few minutes it also
 * asks Typefully about every scheduled note, as the local posting tool does
 * while it is open: a published tweet makes its note posted, and a draft
 * deleted in Typefully makes the note not posted again.
 *
 *   bun run note-tweets-worker            run until stopped
 *   bun run note-tweets-worker --once     one pass of requests and the sync, then exit
 *
 * A request is claimed ('sending') before anything is sent, and a request
 * that fails after Typefully made its draft says so, so a request is never
 * sent twice. */

const SITE = process.env.CN_NOTE_IMAGE_SITE ?? "https://commonnotes.net";
const IMAGE_DIR = process.env.CN_NOTE_IMAGE_DIR ?? new URL("./.state/worker-images/", import.meta.url).pathname;
const REQUEST_POLL_MS = 15_000;
const SYNC_EVERY_MS = 5 * 60_000;
/** A request is taken only while it is this fresh, so a backlog after an
 *  outage does not flood the queue with notes nobody remembers asking for. */
const MAX_REQUEST_AGE_MS = 24 * 3600_000;

export const REQUESTS_TABLE = "everything_x_post_requests";
const MARKS_TABLE = "everything_note_x_marks";

interface PostRequest {
  id: string;
  note_id: string;
  tweet_text: string;
  reply_text: string;
  requested_by: string;
  requested_at: string;
}

export interface WorkerDeps {
  db: SupabaseClient;
  image: (noteId: string) => Promise<ArrayBuffer>;
  draft: typeof createDraft;
  states: typeof draftStates;
  now: () => Date;
}

async function check<T>(what: string, query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const close = (deps: WorkerDeps, id: string, fields: Record<string, unknown>) =>
  check(`closing request ${id}`, deps.db.from(REQUESTS_TABLE).update({ ...fields, done_at: deps.now().toISOString() }).eq("id", id));

/** Carries out one request. Returns what happened, for the log. */
export async function handleRequest(deps: WorkerDeps, request: PostRequest): Promise<string> {
  // Claim it first: only one worker, and only once, ever sends a request.
  const claimed = await check("claiming", deps.db.from(REQUESTS_TABLE).update({ status: "sending" }).eq("id", request.id).eq("status", "pending").select("id"));
  if (!claimed?.length) return `request ${request.id} was taken already`;
  if (deps.now().getTime() - Date.parse(request.requested_at) > MAX_REQUEST_AGE_MS) {
    await close(deps, request.id, { status: "failed", error: "The request waited more than a day; ask again" });
    return `request ${request.id} too old`;
  }
  const mark = await check("reading the mark", deps.db.from(MARKS_TABLE).select("mark").eq("note_id", request.note_id).maybeSingle());
  if (mark && (mark as { mark: string }).mark !== "wont_post") {
    await close(deps, request.id, { status: "failed", error: `The note is ${(mark as { mark: string }).mark} on X already` });
    return `note ${request.note_id} already ${(mark as { mark: string }).mark}`;
  }
  let draft: Awaited<ReturnType<typeof createDraft>>;
  try {
    draft = await deps.draft({
      text: request.tweet_text,
      reply: request.reply_text,
      image: await deps.image(request.note_id),
      title: `Common Note ${request.note_id}`,
      timing: "next_free_slot",
    });
  } catch (error) {
    await close(deps, request.id, { status: "failed", error: String(error instanceof Error ? error.message : error) });
    return `request ${request.id} failed before Typefully made a draft: ${String(error)}`;
  }
  try {
    await check(
      "marking the note scheduled",
      deps.db.from(MARKS_TABLE).upsert({
        note_id: request.note_id,
        mark: "scheduled",
        typefully_draft_id: draft.draftId,
        scheduled_for: draft.scheduledFor,
        marked_by: request.requested_by,
        marked_at: deps.now().toISOString(),
        published_at: null,
        tweet_url: null,
      }),
    );
  } catch (error) {
    await close(deps, request.id, { status: "failed", typefully_draft_id: draft.draftId, error: `Typefully made draft ${draft.draftId}, but the note could not be marked: ${String(error)}` });
    return `request ${request.id}: draft ${draft.draftId} made, mark failed`;
  }
  await close(deps, request.id, { status: "sent", typefully_draft_id: draft.draftId, error: null });
  return `note ${request.note_id} scheduled as Typefully draft ${draft.draftId} for ${draft.scheduledFor ?? "no time"}`;
}

/** Takes every pending request, oldest first. */
export async function handleRequests(deps: WorkerDeps): Promise<string[]> {
  const pending = await check(
    "reading requests",
    deps.db.from(REQUESTS_TABLE).select("id, note_id, tweet_text, reply_text, requested_by, requested_at").eq("status", "pending").order("requested_at").limit(20),
  );
  const log: string[] = [];
  for (const request of (pending ?? []) as PostRequest[]) log.push(await handleRequest(deps, request));
  return log;
}

const sameMoment = (a: string | null, b: string | null) => a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

/** Brings every scheduled note's mark up to date with its Typefully draft, as
 *  everything_update_x_post does for the local tool. Each write changes the
 *  mark only while it is still scheduled for that very draft, so a mark an
 *  admin set in the meantime wins. */
export async function syncScheduled(deps: WorkerDeps): Promise<string[]> {
  const rows = (await check("reading scheduled notes", deps.db.from(MARKS_TABLE).select("note_id, typefully_draft_id, scheduled_for").eq("mark", "scheduled").limit(500))) as {
    note_id: string;
    typefully_draft_id: string;
    scheduled_for: string | null;
  }[];
  if (!rows?.length) return [];
  const states: Record<string, TypefullyDraftState> = await deps.states(rows.map((row) => row.typefully_draft_id));
  const log: string[] = [];
  for (const row of rows) {
    const state = states[row.typefully_draft_id];
    const still = { note_id: row.note_id, mark: "scheduled", typefully_draft_id: row.typefully_draft_id };
    const marks = deps.db.from(MARKS_TABLE);
    if (!state || state.state === "failed") continue;
    if (state.state === "deleted") {
      await check("clearing a deleted draft", marks.delete().match(still));
      log.push(`note ${row.note_id}: draft deleted in Typefully, not posted again`);
    } else if (state.state === "published") {
      await check("marking posted", marks.update({ mark: "posted", published_at: state.publishedAt ?? deps.now().toISOString(), tweet_url: state.tweetUrl }).match(still));
      log.push(`note ${row.note_id}: posted ${state.tweetUrl ?? ""}`);
    } else if (!sameMoment(state.scheduledFor, row.scheduled_for)) {
      await check("moving the time", marks.update({ scheduled_for: state.scheduledFor }).match(still));
    }
  }
  return log;
}

async function main() {
  await mkdir(IMAGE_DIR, { recursive: true });
  const deps: WorkerDeps = {
    db: getSupabaseClient(),
    image: async (noteId) => {
      const path = `${IMAGE_DIR}${noteId}.png`;
      await takeNoteImage(SITE, noteId, path);
      return Bun.file(path).arrayBuffer();
    },
    draft: createDraft,
    states: draftStates,
    now: () => new Date(),
  };
  const once = process.argv.includes("--once");
  let lastSync = 0;
  for (;;) {
    try {
      for (const line of await handleRequests(deps)) console.log(line);
      if (Date.now() - lastSync >= SYNC_EVERY_MS) {
        lastSync = Date.now();
        for (const line of await syncScheduled(deps)) console.log(line);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    if (once) break;
    await Bun.sleep(REQUEST_POLL_MS);
  }
  await closeBrowser();
}

if (import.meta.main) await main();
