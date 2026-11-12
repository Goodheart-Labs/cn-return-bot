import type { Session } from "@supabase/supabase-js";
import { mintSelfVoteDonation, type MintedDonation } from "./donations";
import { buildVideoLink } from "./pageUrls";
import { displayName } from "./session";
import { supabase } from "./supabase";
import type { NoteRow } from "./types";
import { formatVideoTime } from "./videoTime";

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

/** What a reader's new note is about: a span of text they selected, or a
 *  stretch of a video between two whole seconds. */
export type NoteAnchor =
  | { kind: "text"; text: string; contextParagraph?: string | null }
  | { kind: "video"; videoId: string; startSeconds: number; endSeconds: number };

/** The claim columns that say what a reader's note is about. A note on a video
 *  quotes no captions. Its claim names the stretch of the video instead, and
 *  its link plays the video from the stretch's start. */
function anchorColumns(anchor: NoteAnchor, itemUrl: string) {
  if (anchor.kind === "video") {
    return {
      claim: `At ${formatVideoTime(anchor.startSeconds)} to ${formatVideoTime(anchor.endSeconds)} in the video`,
      context_quote: null,
      context_url: buildVideoLink(anchor.videoId, anchor.startSeconds),
      start_seconds: anchor.startSeconds,
      end_seconds: anchor.endSeconds,
    };
  }
  const text = anchor.text.trim();
  const contextParagraph = anchor.contextParagraph?.trim();
  return {
    claim: text.slice(0, CLAIM_PREVIEW_CHARS),
    context_quote: text,
    ...(contextParagraph ? { context_paragraph: contextParagraph } : {}),
    context_url: itemUrl,
  };
}

/** Writes a brand-new note on what the reader picked: the user's claim first,
 *  then the draft note on it. */
export async function postClaimWithNote(params: {
  itemId: string;
  itemUrl: string;
  anchor: NoteAnchor;
  note: string;
  session: Session;
  signed: boolean;
}): Promise<PostedNote> {
  const { data: claim, error } = await supabase
    .from("everything_claims")
    .insert({
      item_id: params.itemId,
      ...anchorColumns(params.anchor, params.itemUrl),
      judgement: "user",
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
