import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { displayName } from "./session";
import { isEarnestNote } from "./judgeNote";
import type { NoteRow } from "./types";

export type PostOutcome =
  | { type: "posted"; claimId: string; noteId: string }
  | { type: "rejected" } // judge-note said not an earnest note
  | { type: "error"; message: string };

// A user claim's `claim` column is a preview of the anchor text, not the
// full quote (that lives in context_quote).
const CLAIM_PREVIEW_CHARS = 300;

/** Write a brand-new note anchored to a text span: judge earnest-vs-trolling
 *  FIRST (a rejected note leaves no orphan claim), then insert the user claim
 *  and the draft note on it. */
export async function postClaimWithNote(params: {
  itemId: string;
  itemUrl: string;
  anchorText: string;
  note: string;
  session: Session;
  signed: boolean;
}): Promise<PostOutcome> {
  const { itemId, itemUrl, session, signed } = params;
  const anchorText = params.anchorText.trim();
  const note = params.note.trim();
  try {
    const earnest = await isEarnestNote(note, anchorText);
    if (!earnest) return { type: "rejected" };
    const { data: claim, error: claimError } = await supabase
      .from("everything_claims")
      .insert({
        item_id: itemId,
        claim: anchorText.slice(0, CLAIM_PREVIEW_CHARS),
        judgement: "user",
        context_quote: anchorText,
        context_url: itemUrl,
        status: "note",
        created_by: session.user.id,
      })
      .select("id")
      .single();
    if (claimError || !claim) return { type: "error", message: claimError?.message ?? "could not create the claim" };
    const { data: noteRow, error: noteError } = await supabase
      .from("everything_notes")
      .insert({
        claim_id: claim.id,
        note,
        author_id: session.user.id,
        author_name: signed ? displayName(session) : null,
        status: "draft",
      })
      .select("id")
      .single();
    if (noteError || !noteRow) return { type: "error", message: noteError?.message ?? "could not create the note" };
    return { type: "posted", claimId: claim.id, noteId: noteRow.id };
  } catch (err) {
    return { type: "error", message: (err as Error).message };
  }
}

/** Post an improved version of an existing note as your own draft note on the
 *  same claim, linked to the original via improved_from_note_id (it shows as
 *  its own card, it does not replace it), judge-gated the same way. */
export async function postImprovement(params: {
  note: NoteRow;
  text: string;
  session: Session;
  signed: boolean;
}): Promise<PostOutcome> {
  const { note, session, signed } = params;
  const text = params.text.trim();
  try {
    const earnest = await isEarnestNote(text, note.claim?.context_quote ?? "", note.note);
    if (!earnest) return { type: "rejected" };
    const { data: noteRow, error } = await supabase
      .from("everything_notes")
      .insert({
        claim_id: note.claim_id,
        note: text,
        author_id: session.user.id,
        author_name: signed ? displayName(session) : null,
        improved_from_note_id: note.id,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !noteRow) return { type: "error", message: error?.message ?? "could not create the note" };
    return { type: "posted", claimId: note.claim_id, noteId: noteRow.id };
  } catch (err) {
    return { type: "error", message: (err as Error).message };
  }
}
