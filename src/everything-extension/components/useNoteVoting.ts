import { useEffect, useState } from "react";
import { useSession } from "../../everything-shared/auth";
import { supabase } from "../../everything-shared/supabase";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { fetchNote } from "../../everything-shared/notesQuery";
import type { NoteRow } from "../../everything-shared/types";

/** Voting state shared by the inline popovers and the YouTube overlay:
 *  the caller's votes, optimistic cast/clear, a post-vote refetch (counts are
 *  trigger-computed server-side), and the signed-out hint. */
export function useNoteVoting(onNoteUpdated: (note: NoteRow) => void) {
  const { session } = useSession();
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [signInHint, setSignInHint] = useState(false);

  useEffect(() => {
    if (!session) return setMyVotes(new Map());
    fetchMyVotes().then(setMyVotes);
  }, [session]);

  const onNeedLogin = () => setSignInHint(true);

  const handleVote = async (note: NoteRow, vote: Vote) => {
    // React state can lag the shared chrome.storage session (login happened in
    // the popup after this overlay mounted) — re-check at click time before
    // bouncing the user to the sign-in hint.
    const user = session?.user ?? (await supabase.auth.getSession()).data.session?.user;
    if (!user) return onNeedLogin();
    const current = myVotes.get(note.id);
    const next = new Map(myVotes);
    if (current === vote) {
      next.delete(note.id);
      setMyVotes(next);
      await clearVote(note.id);
    } else {
      next.set(note.id, vote);
      setMyVotes(next);
      await castVote(note.id, user.id, vote);
    }
    const fresh = await fetchNote(note.id);
    if (fresh) onNoteUpdated(fresh);
  };

  // The DB self-vote trigger makes a just-posted note start with its author's
  // helpful vote — mirror it locally so the pills light up without a refetch.
  const recordAuthored = (noteId: string) => setMyVotes((m) => new Map(m).set(noteId, 1));

  return { session, myVotes, handleVote, recordAuthored, onNeedLogin, signInHint, dismissSignInHint: () => setSignInHint(false) };
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
