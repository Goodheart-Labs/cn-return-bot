import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { displayName } from "./session";
import { isEarnestNote } from "./judgeNote";
import type { NoteRow } from "./types";

export type PostOutcome =
  | { type: "posted"; claimId: string; noteId: string }
  | { type: "rejected" } // The judge-note check decided the text was not an earnest note.
  | { type: "error"; message: string };

// On a claim a user created, the `claim` column holds only a preview of the
// anchor text. The full text lives in `context_quote`.
const CLAIM_PREVIEW_CHARS = 300;

/** Writes a brand-new note anchored to a span of text. The earnest-note judge
 *  runs first, before anything is inserted, so a rejected note never leaves an
 *  orphan claim behind. Only after it passes do we insert the user's claim and
 *  the draft note on it. */
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

/** Posts an improved version of an existing note as the user's own draft note on
 *  the same claim. The `improved_from_note_id` column links it back to the
 *  original. The improvement shows as its own card and never replaces the note it
 *  improves. The earnest-note judge gates it the same way. */
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
