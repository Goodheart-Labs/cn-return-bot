import { useState } from "react";
import type { MintedDonation } from "@cn/core/donations";
import { noteStatus, noteTallyVisible } from "@cn/core/noteScore";
import type { NoteRow } from "@cn/core/types";
import { VoteDonation } from "@cn/features/donations/VoteDonation";
import { takeMintedDonation } from "@cn/features/donations/mintedDonations";
import { NoteBox } from "@cn/features/notes/NoteCard";
import { NoteMenu } from "@cn/features/notes/NoteMenu";
import { useMyVotes, useVoteOnNote } from "@cn/features/notes/useVotes";
import { VoteRatings } from "@cn/features/notes/VoteRatings";
import { useVotingNudge, VotingNudge } from "@cn/features/notes/VotingNudge";

/** One votable note inside an extension overlay. It draws the box tinted by the
 *  note's status, the rating pills, the donation notice that appears after a
 *  vote, and the action row. The action row offers suggesting an improvement,
 *  saying that no note is needed, and sharing. This is the website's vote flow
 *  at popover size. Every note on a claim renders as its own box beside the
 *  others. */
export function NoteWithActions({ note, shareUrl }: { note: NoteRow; shareUrl: string }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // The donation that was just minted. It makes the notice appear beneath the
  // pills. A note the viewer just posted starts with the parked donation its
  // automatic Helpful vote minted, so the notice explains the pill that is
  // already lit. It is cleared when the vote is retracted, which leaves
  // myVote undefined, and when the notice closes itself.
  const [cast, setCast] = useState<MintedDonation | null>(() => takeMintedDonation(note.id));
  const status = noteStatus(note);
  const nudge = useVotingNudge();
  const myVote = useMyVotes().get(note.id);
  const voteOnNote = useVoteOnNote();
  return (
    <div>
      <NoteBox note={note} status={status} sourcesOpen={sourcesOpen}>
        <span className="relative inline-flex">
          {nudge.show && <VotingNudge onDismiss={nudge.dismiss} />}
          <VoteRatings
            helpful={note.helpful_count}
            somewhatHelpful={note.somewhat_helpful_count}
            notHelpful={note.not_helpful_count}
            myVote={myVote}
            showCounts={noteTallyVisible(status, myVote, note.created_at)}
            onVote={(vote) => {
              if (nudge.show) nudge.dismiss();
              void voteOnNote(note, vote).then(setCast);
            }}
          />
        </span>
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
      <NoteMenu
        note={note}
        shareUrl={shareUrl}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
    </div>
  );
}
