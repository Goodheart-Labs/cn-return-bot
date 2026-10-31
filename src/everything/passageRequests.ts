/* Requests on selected words of a page (GOO-663). Intake puts the page in the
 * queue and marks each such request as running. The writer that takes the page
 * checks the passages and answers each request with whether it got a note. */

import { getSupabaseClient } from "../api/supabaseClient";
import { PASSAGE_CHECK } from "../everything-core/requestProgress";

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
  const { data: rows, error } = await getSupabaseClient()
    .from("everything_note_requests")
    .select("id, selection, steer")
    .eq("item_id", itemId)
    .eq("status", "enqueued")
    .eq("status_reason", PASSAGE_CHECK.running)
    .not("selection", "is", null)
    .order("created_at");
  if (error) throw new Error(`Supabase: ${error.message}`);
  return rows.map((row) => ({ id: row.id, passage: row.selection!, reason: row.steer }));
}

/** Answers a request with whether its passage got a note. The reader's
 *  progress card shows the answer. */
export async function answerPassageRequest(requestId: string, gotNote: boolean): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("everything_note_requests")
    .update({ status: "done", status_reason: gotNote ? PASSAGE_CHECK.note : PASSAGE_CHECK.noNote })
    .eq("id", requestId);
  if (error) throw new Error(`Supabase: ${error.message}`);
}
