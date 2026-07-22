import { useEffect, useState } from "react";
import { useSession } from "../../everything-shared/auth";
import { supabase } from "../../everything-shared/supabase";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes, fetchNnnEntry } from "../../everything-shared/noteNotNeeded";
import { fetchNote } from "../../everything-shared/notesQuery";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { donationPair, priorTally } from "../../everything-web/src/lib/donationScoring";
import { saveDonation, usePreferredCharity, type MintedDonation } from "../../everything-web/src/lib/donations";

/** Voting state shared by the inline popovers and the YouTube overlay:
 *  the caller's note + note-not-needed votes, optimistic cast/clear with the
 *  website's donation minting, a post-vote refetch (counts are
 *  trigger-computed server-side), and the signed-out hint. */
export function useNoteVoting(onNoteUpdated: (note: NoteRow) => void, onNnnUpdated?: (entry: NnnRow) => void) {
  const { session } = useSession();
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [myNnnVotes, setMyNnnVotes] = useState<Map<string, Vote>>(new Map());
  const [signInHint, setSignInHint] = useState(false);
  // A fresh vote's donation starts at the remembered charity; the donation
  // box lets the voter redirect it afterwards.
  const [preferredCharity] = usePreferredCharity();

  useEffect(() => {
    if (!session) {
      setMyVotes(new Map());
      setMyNnnVotes(new Map());
      return;
    }
    fetchMyVotes().then(setMyVotes);
    fetchMyNnnVotes().then(setMyNnnVotes);
  }, [session]);

  const onNeedLogin = () => setSignInHint(true);

  // React state can lag the shared chrome.storage session (login happened in
  // the popup after this overlay mounted) — re-check at click time before
  // bouncing the user to the sign-in hint.
  const currentUser = async () =>
    session?.user ?? (await supabase.auth.getSession()).data.session?.user ?? null;

  /** Cast/retract a note vote and mint its donation, same rules as the
   *  website: the outcome-contingent pair is frozen at the pre-vote tally and
   *  keyed to the vote row. Resolves to the minted donation, or null on
   *  retract / own note / signed out. */
  const handleVote = async (note: NoteRow, vote: Vote): Promise<MintedDonation | null> => {
    const user = await currentUser();
    if (!user) {
      onNeedLogin();
      return null;
    }
    const current = myVotes.get(note.id);
    const next = new Map(myVotes);
    let minted: MintedDonation | null = null;
    if (current === vote) {
      next.delete(note.id);
      setMyVotes(next);
      await clearVote(note.id); // cascades the donation away
    } else {
      next.set(note.id, vote);
      setMyVotes(next);
      const voteId = await castVote(note.id, user.id, vote);
      if (voteId && note.author_id !== user.id) {
        const pair = donationPair(priorTally(note, current), vote);
        // A backend without migration 061 rejects the pair columns — keep the
        // vote, just don't promise a donation the ledger didn't record.
        const { error } = await saveDonation(voteId, preferredCharity, pair);
        if (!error) minted = { voteId, charity: preferredCharity, pair };
      }
    }
    const fresh = await fetchNote(note.id);
    if (fresh) onNoteUpdated(fresh);
    return minted;
  };

  /** Entry votes never mint donations (same as the website). */
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

  // The DB self-vote triggers make a just-posted note/entry start with its
  // author's helpful vote — mirror it locally so the pills light up without a
  // refetch.
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
    signInHint,
    dismissSignInHint: () => setSignInHint(false),
  };
}

/** Swap a refetched note into a claim group, keeping the joined claim the
 *  group already carries (the refetch result has it too, but identity-stable
 *  props avoid re-anchoring work). */
export function replaceNoteInGroup<T extends { primary: NoteRow; alternatives: NoteRow[] }>(group: T, updated: NoteRow): T {
  return {
    ...group,
    primary: group.primary.id === updated.id ? { ...updated, claim: group.primary.claim } : group.primary,
    alternatives: group.alternatives.map((a) => (a.id === updated.id ? { ...updated, claim: a.claim } : a)),
  };
}
