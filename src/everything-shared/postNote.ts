import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { displayName } from "./session";
import type { NoteRow } from "./types";
import { donationPair } from "../everything-web/src/lib/donationScoring";
import { parkMintedDonation, preferredCharity, saveDonation } from "../everything-web/src/lib/donations";

/** Mints the donation for the author's automatic Helpful vote, which a
 *  database trigger casts the moment a note is inserted. The trigger writes
 *  the vote row directly, so the client mints its donation here, from the
 *  same formula every clicked vote uses. The self-vote is always the note's
 *  first vote, so the prior tally is empty. The minted donation is parked for
 *  the note's card, which shows the notice when it first renders. A failure
 *  here never fails the posting: the note is already saved, and against a
 *  backend without the trigger or the ledger there is nothing to mint. */
async function mintAuthorSelfVoteDonation(noteId: string, author: Session["user"]): Promise<void> {
  try {
    const { data: vote } = await supabase
      .from("everything_votes")
      .select("id")
      .eq("note_id", noteId)
      .eq("voter_id", author.id)
      .maybeSingle();
    if (!vote) return;
    const pair = donationPair({ helpful: 0, somewhatHelpful: 0, notHelpful: 0 }, 1);
    const charity = preferredCharity(author);
    const { error } = await saveDonation(vote.id, charity, pair);
    if (!error) parkMintedDonation(noteId, { voteId: vote.id, charity, pair });
  } catch (err) {
    console.warn("[common-notes] could not mint the self-vote donation:", err);
  }
}

export type PostOutcome =
  | { type: "posted"; claimId: string; noteId: string }
  | { type: "error"; message: string };

// On a claim a user created, the `claim` column holds only a preview of the
// anchor text. The full text lives in `context_quote`.
const CLAIM_PREVIEW_CHARS = 300;

/** Writes a brand-new note anchored to a span of text: the user's claim first,
 *  then the draft note on it. */
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
    await mintAuthorSelfVoteDonation(noteRow.id, session.user);
    return { type: "posted", claimId: claim.id, noteId: noteRow.id };
  } catch (err) {
    return { type: "error", message: (err as Error).message };
  }
}

/** Posts an improved version of an existing note as the user's own draft note on
 *  the same claim. The `improved_from_note_id` column links it back to the
 *  original. The improvement shows as its own card and never replaces the note it
 *  improves. */
export async function postImprovement(params: {
  note: NoteRow;
  text: string;
  session: Session;
  signed: boolean;
}): Promise<PostOutcome> {
  const { note, session, signed } = params;
  const text = params.text.trim();
  try {
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
    await mintAuthorSelfVoteDonation(noteRow.id, session.user);
    return { type: "posted", claimId: note.claim_id, noteId: noteRow.id };
  } catch (err) {
    return { type: "error", message: (err as Error).message };
  }
}
