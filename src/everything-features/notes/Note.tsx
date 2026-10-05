import { useState, type ReactNode } from "react";
import type { MintedDonation } from "@cn/core/donations";
import { noteStatus } from "@cn/core/noteScore";
import type { NoteRow } from "@cn/core/types";
import { VoteDonation } from "../donations/VoteDonation";
import { takeMintedDonation } from "../donations/mintedDonations";
import { NoteBox } from "./NoteBox";
import { NoteMenu } from "./NoteMenu";
import { useMyVotes, useVoteOnNote } from "./useVotes";
import { VoteRatings } from "./VoteRatings";
import { useVotingNudge, VotingNudge } from "./VotingNudge";

/** One note with everything a reader can do on it: the box tinted by its
 *  rating status, the rating pills, the donation notice that appears after a
 *  vote, and the action row. The website's feed and every extension overlay
 *  render this same component. `children` adds actions to the action row. */
export function Note({ note, shareUrl, onDeleted, children }: {
  note: NoteRow;
  /** The absolute deep link the Share button copies. */
  shareUrl: string;
  onDeleted?: () => void;
  children?: ReactNode;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // The donation just minted, which shows the notice beneath the pills. A note
  // the reader just posted starts with the donation its automatic Helpful vote
  // minted, so the notice explains the pill that is already lit. Retracting
  // the vote, or the notice closing itself, clears it.
  const [cast, setCast] = useState<MintedDonation | null>(() => takeMintedDonation(note.id));
  const nudge = useVotingNudge();
  const myVote = useMyVotes().get(note.id);
  const voteOnNote = useVoteOnNote();
  // The badge, the box tint and the donation payout all read this one status.
  const status = noteStatus(note);
  return (
    <div>
      <NoteBox note={note} status={status} sourcesOpen={sourcesOpen} question={nudge.show ? <VotingNudge onDismiss={nudge.dismiss} /> : undefined}>
        <VoteRatings
          myVote={myVote}
          onVote={(vote) => {
            if (nudge.show) nudge.dismiss();
            void voteOnNote(note, vote).then(setCast);
          }}
        />
      </NoteBox>
      {cast && myVote !== undefined && (
        <VoteDonation
          voteId={cast.voteId}
          pair={cast.pair}
          charity={cast.charity}
          status={status}
          onCharityChange={(charity) => setCast((prev) => prev && { ...prev, charity })}
          onClose={() => setCast(null)}
        />
      )}
      <NoteMenu onDeleted={onDeleted} note={note} shareUrl={shareUrl} sourcesOpen={sourcesOpen} onToggleSources={() => setSourcesOpen((o) => !o)}>
        {children}
      </NoteMenu>
    </div>
  );
}
