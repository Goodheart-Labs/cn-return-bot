import { useEffect, useState } from "react";
import { ensureUser, useSession } from "../../everything-shared/auth";
import { supabase } from "../../everything-shared/supabase";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { track } from "../../everything-shared/analytics";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes, fetchNnnEntry } from "../../everything-shared/noteNotNeeded";
import { fetchNote } from "../../everything-shared/notesQuery";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { donationPair, priorTally } from "../../everything-web/src/lib/donationScoring";
import { preferredCharity, saveDonation, type MintedDonation } from "../../everything-web/src/lib/donations";

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

  /** Refetches which notes and entries the user has voted on. The overlays
   *  call it whenever their note data refreshes, because a vote can appear
   *  without this hook seeing it cast: writing a note makes a database
   *  trigger cast the author's own helpful vote. Without the refetch that
   *  pill stayed unlit and the donation notice never showed. */
  const refreshVotes = () => {
    if (!session) {
      setMyVotes(new Map());
      setMyNnnVotes(new Map());
      return;
    }
    fetchMyVotes().then(setMyVotes);
    fetchMyNnnVotes().then(setMyNnnVotes);
  };

  useEffect(() => {
    refreshVotes();
    // Signing in is what the form was open for, so it goes away on its own.
    if (session) setLoginOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const onNeedLogin = () => setLoginOpen(true);

  // The React state can lag behind the shared session in chrome.storage. That
  // happens when the user logs in from the popup after this overlay mounted.
  // So we re-check at click time, and a reader with no session at all gets an
  // invisible anonymous account instead of a sign-in form. Only when even
  // that fails, for example because the backend has anonymous sign-ins
  // disabled, do we fall back to the form.
  const currentUser = async () =>
    session?.user ?? (await supabase.auth.getSession()).data.session?.user ?? (await ensureUser());

  /** Cast or retract a vote on a note and mint its donation. The rules are the
   *  same as on the website, and a vote on your own note mints like any other.
   *  The pair of contingent amounts is computed from the tally as it stood
   *  before this vote, and it is stored against the vote row. This resolves to
   *  the minted donation. It resolves to null when the vote is retracted or
   *  when nobody is signed in. */
  const handleVote = async (note: NoteRow, vote: Vote): Promise<MintedDonation | null> => {
    const user = await currentUser();
    if (!user) {
      // Even the silent anonymous sign-in failed, so the form is the only
      // way left to vote.
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
        const pair = donationPair(priorTally(note, current), vote);
        // The donation goes to the charity remembered on the account. The
        // donation box lets the voter redirect it afterwards.
        const charity = preferredCharity(user);
        // A backend that has not run migration 061 rejects the pair columns.
        // We keep the vote in that case. We just do not promise a donation
        // that the ledger never recorded.
        const { error } = await saveDonation(voteId, charity, pair);
        if (!error) minted = { voteId, charity, pair };
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
    refreshVotes,
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
