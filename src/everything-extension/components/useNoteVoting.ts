import { useEffect, useState } from "react";
import { useSession } from "../../everything-shared/auth";
import { supabase } from "../../everything-shared/supabase";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { track } from "../../everything-shared/analytics";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes, fetchNnnEntry } from "../../everything-shared/noteNotNeeded";
import { fetchNote } from "../../everything-shared/notesQuery";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { donationPair, priorTally } from "../../everything-web/src/lib/donationScoring";
import { saveDonation, usePreferredCharity, type MintedDonation } from "../../everything-web/src/lib/donations";

/** The voting state shared by the inline popovers and the YouTube overlay. It
 *  holds the caller's own votes, both on notes and on note-not-needed entries.
 *  It casts and clears votes optimistically and mints donations the same way
 *  the website does. It refetches after a vote, because the vote counts are
 *  computed by database triggers. It also decides when the inline login form
 *  is shown to a signed-out reader. */
export function useNoteVoting(onNoteUpdated: (note: NoteRow) => void, onNnnUpdated?: (entry: NnnRow) => void) {
  const { session } = useSession();
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [myNnnVotes, setMyNnnVotes] = useState<Map<string, Vote>>(new Map());
  const [loginOpen, setLoginOpen] = useState(false);
  // A new vote's donation goes to the charity the voter picked last time. The
  // donation box lets them redirect it afterwards.
  const [preferredCharity] = usePreferredCharity();

  useEffect(() => {
    if (!session) {
      setMyVotes(new Map());
      setMyNnnVotes(new Map());
      return;
    }
    fetchMyVotes().then(setMyVotes);
    fetchMyNnnVotes().then(setMyNnnVotes);
    // Signing in is what the form was open for, so it goes away on its own.
    setLoginOpen(false);
  }, [session]);

  const onNeedLogin = () => setLoginOpen(true);

  // The React state can lag behind the shared session in chrome.storage. That
  // happens when the user logs in from the popup after this overlay mounted.
  // So we re-check at click time before showing the sign-in hint.
  const currentUser = async () =>
    session?.user ?? (await supabase.auth.getSession()).data.session?.user ?? null;

  /** Cast or retract a vote on a note and mint its donation. The rules are the
   *  same as on the website. The pair of contingent amounts is computed from
   *  the tally as it stood before this vote, and it is stored against the vote
   *  row. This resolves to the minted donation. It resolves to null when the
   *  vote is retracted, when the note is the voter's own, or when nobody is
   *  signed in. */
  const handleVote = async (note: NoteRow, vote: Vote): Promise<MintedDonation | null> => {
    const user = await currentUser();
    if (!user) {
      // An anonymous reader hit the vote wall — the funnel's sign-in prompt.
      track("vote_gated_login", { note_id: note.id });
      onNeedLogin();
      return null;
    }
    const current = myVotes.get(note.id);
    const next = new Map(myVotes);
    let minted: MintedDonation | null = null;
    if (current === vote) {
      next.delete(note.id);
      setMyVotes(next);
      await clearVote(note.id); // The donation row is deleted along with it.
    } else {
      next.set(note.id, vote);
      setMyVotes(next);
      const voteId = await castVote(note.id, user.id, vote, "extension");
      if (voteId) {
        // The vote funnel step. distinct_notes_voted is the count AFTER this
        // cast (myVotes holds ALL the caller's votes via RLS, like the website),
        // so the "voted on ≥ N notes" steps filter on distinct_notes_voted >= N.
        track("note_voted", {
          note_id: note.id,
          vote, // 1 helpful · 0 somewhat · -1 not helpful
          changed_vote: current != null,
          own_note: note.author_id === user.id,
          distinct_notes_voted: next.size,
        });
      }
      if (voteId && note.author_id !== user.id) {
        const pair = donationPair(priorTally(note, current), vote);
        // A backend that has not run migration 061 rejects the pair columns.
        // We keep the vote in that case. We just do not promise a donation
        // that the ledger never recorded.
        const { error } = await saveDonation(voteId, preferredCharity, pair);
        if (!error) minted = { voteId, charity: preferredCharity, pair };
      }
    }
    const fresh = await fetchNote(note.id);
    if (fresh) onNoteUpdated(fresh);
    return minted;
  };

  /** Votes on note-not-needed entries never mint a donation. The website
   *  behaves the same way. */
  const handleNnnVote = async (entry: NnnRow, vote: Vote) => {
    const user = await currentUser();
    if (!user) return onNeedLogin();
    const current = myNnnVotes.get(entry.id);
    const next = new Map(myNnnVotes);
    if (current === vote) {
      next.delete(entry.id);
      setMyNnnVotes(next);
      await clearNnnVote(entry.id);
    } else {
      next.set(entry.id, vote);
      setMyNnnVotes(next);
      await castNnnVote(entry.id, user.id, vote);
    }
    const fresh = await fetchNnnEntry(entry.id);
    if (fresh) onNnnUpdated?.(fresh);
  };

  // A database trigger casts the author's own helpful vote on a note or entry
  // as soon as it is posted. We mirror that vote locally so the pills light up
  // without waiting for a refetch.
  const recordAuthored = (noteId: string) => setMyVotes((m) => new Map(m).set(noteId, 1));
  const recordNnnAuthored = (entryId: string) => setMyNnnVotes((m) => new Map(m).set(entryId, 1));

  return {
    session,
    myVotes,
    myNnnVotes,
    handleVote,
    handleNnnVote,
    recordAuthored,
    recordNnnAuthored,
    onNeedLogin,
    loginOpen,
    closeLogin: () => setLoginOpen(false),
  };
}

/** Swap a refetched note into a claim group. The group keeps the claim object
 *  it already carried. The refetched note carries an equal claim, but reusing
 *  the same object keeps the prop identity stable, which saves the anchoring
 *  work a new object would trigger. */
export function replaceNoteInGroup<T extends { primary: NoteRow; alternatives: NoteRow[] }>(group: T, updated: NoteRow): T {
  return {
    ...group,
    primary: group.primary.id === updated.id ? { ...updated, claim: group.primary.claim } : group.primary,
    alternatives: group.alternatives.map((a) => (a.id === updated.id ? { ...updated, claim: a.claim } : a)),
  };
}
