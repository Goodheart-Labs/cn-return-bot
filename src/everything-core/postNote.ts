import type { Session } from "@supabase/supabase-js";
import { mintSelfVoteDonation, type MintedDonation } from "./donations";
import { displayName } from "./session";
import { supabase } from "./supabase";
import type { NoteRow } from "./types";

/** A note the reader just posted, with the donation its automatic Helpful vote
 *  minted. The donation is null when minting failed, which never fails the
 *  posting itself. */
export interface PostedNote {
  claimId: string;
  noteId: string;
  donation: MintedDonation | null;
}

async function insertDraftNote(row: { claimId: string; text: string; session: Session; signed: boolean; improvedFrom?: string }) {
  const { data, error } = await supabase
    .from("everything_notes")
    .insert({
      claim_id: row.claimId,
      note: row.text.trim(),
      author_id: row.session.user.id,
      author_name: row.signed ? displayName(row.session) : null,
      improved_from_note_id: row.improvedFrom ?? null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { claimId: row.claimId, noteId: data.id, donation: await mintSelfVoteDonation(data.id, row.session.user) };
}

// On a claim a user created, the `claim` column holds only a preview of the
// anchor text. The full text lives in `context_quote`.
const CLAIM_PREVIEW_CHARS = 300;

/** Writes a brand-new note anchored to a span of text: the user's claim first,
 *  then the draft note on it. */
export async function postClaimWithNote(params: {
  itemId: string;
  itemUrl: string;
  anchorText: string;
  contextParagraph?: string | null;
  note: string;
  session: Session;
  signed: boolean;
}): Promise<PostedNote> {
  const anchorText = params.anchorText.trim();
  const contextParagraph = params.contextParagraph?.trim();
  const { data: claim, error } = await supabase
    .from("everything_claims")
    .insert({
      item_id: params.itemId,
      claim: anchorText.slice(0, CLAIM_PREVIEW_CHARS),
      judgement: "user",
      context_quote: anchorText,
      ...(contextParagraph ? { context_paragraph: contextParagraph } : {}),
      context_url: params.itemUrl,
      status: "note",
      created_by: params.session.user.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return insertDraftNote({ claimId: claim.id, text: params.note, session: params.session, signed: params.signed });
}

/** Posts an improved version of an existing note as the user's own draft note
 *  on the same claim. The `improved_from_note_id` column links it back to the
 *  original. The improvement shows as its own card and never replaces the note
 *  it improves. */
export function postImprovement(params: { note: NoteRow; text: string; session: Session; signed: boolean }): Promise<PostedNote> {
  const { note, ...rest } = params;
  return insertDraftNote({ claimId: note.claim_id, improvedFrom: note.id, ...rest });
}
