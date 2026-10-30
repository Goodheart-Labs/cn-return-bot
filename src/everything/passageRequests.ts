/* Requests on selected words of a page (GOO-663). Intake puts the page in the
 * queue and marks the request as running. Whoever finishes the page answers
 * the request: the Claude note writer for the passages it was given, and the
 * pipeline worker for every open request on an item it marks done. Both answer
 * from the notes table, so the answer does not depend on which writer did the
 * work. */

import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../everything-core/paging";
import { PASSAGE_CHECK } from "../everything-core/requestProgress";
import { throwOnError } from "./db";

/** A reader's request for a note on selected words of a post, with the
 *  reader's reason when they gave one. */
export type PassageRequest = { id: string; passage: string; reason: string | null };

/** Two passages count as the same place when one contains the other or they
 *  share this many characters in a row. */
const SHARED_PASSAGE_CHARS = 40;

const normalizedPassage = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function passagesOverlap(a: string, b: string): boolean {
  const [x, y] = [normalizedPassage(a), normalizedPassage(b)];
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  for (let i = 0; i + SHARED_PASSAGE_CHARS <= shorter.length; i += SHARED_PASSAGE_CHARS / 2) {
    if (longer.includes(shorter.slice(i, i + SHARED_PASSAGE_CHARS))) return true;
  }
  return false;
}

/** The passage requests on an item that nobody has answered yet. */
export async function openPassageRequests(itemId: string): Promise<PassageRequest[]> {
  const rows = throwOnError(
    await getSupabaseClient()
      .from("everything_note_requests")
      .select("id, selection, steer")
      .eq("item_id", itemId)
      .eq("status", "enqueued")
      .eq("status_reason", PASSAGE_CHECK.running)
      .not("selection", "is", null)
      .order("created_at"),
  )!;
  return rows.map((row) => ({ id: row.id, passage: row.selection!, reason: row.steer }));
}

/** Answers each request with whether a note written since the request covers
 *  its passage. The reader's progress card shows the answer. */
export async function answerPassageRequests(itemId: string, requestIds: string[]): Promise<void> {
  if (!requestIds.length) return;
  const requests = throwOnError(
    await getSupabaseClient().from("everything_note_requests").select("id, selection, created_at").in("id", requestIds),
  )!;
  const earliest = requests.map((request) => request.created_at).sort()[0];
  if (!earliest) return;
  const noted = await fetchAllRows<{ id: string; claim: string; context_quote: string | null; everything_notes: { created_at: string }[] }>(
    () =>
      getSupabaseClient()
        .from("everything_claims")
        .select("id, claim, context_quote, everything_notes!inner(created_at)")
        .eq("item_id", itemId)
        .gte("everything_notes.created_at", earliest),
    "id",
    { label: "notes on requested passages" },
  );
  for (const request of requests) {
    const gotNote = noted.some(
      (claim) =>
        claim.everything_notes.some((note) => Date.parse(note.created_at) >= Date.parse(request.created_at)) &&
        passagesOverlap(claim.context_quote ?? claim.claim, request.selection ?? ""),
    );
    throwOnError(
      await getSupabaseClient()
        .from("everything_note_requests")
        .update({ status: "done", status_reason: gotNote ? PASSAGE_CHECK.note : PASSAGE_CHECK.noNote })
        .eq("id", request.id),
    );
  }
}
