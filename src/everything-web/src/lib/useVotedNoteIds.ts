import { useState } from "react";
import { useLoadedMyVotes } from "@cn/features/notes/useVotes";

/** The ids of the notes the reader had voted on when the feed was last
 *  arranged. The page uses it to hide those notes. A vote cast after that
 *  moment does not hide its card, so the reader can still change the vote and
 *  read the donation notice. A new snapshot is taken when `resetKey` changes.
 *  It is undefined until the reader's votes have loaded for the first time. */
export function useVotedNoteIds(resetKey: string): ReadonlySet<string> | undefined {
  const votes = useLoadedMyVotes();
  const [snapshot, setSnapshot] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  // Taking the snapshot during render is React's pattern for state derived
  // from props: React re-renders straight away with the new snapshot.
  if (votes && snapshot?.key !== resetKey) setSnapshot({ key: resetKey, ids: new Set(votes.keys()) });
  return snapshot?.ids;
}
