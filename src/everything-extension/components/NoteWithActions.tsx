import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { VoteRatings } from "../../dashboard-shared/Ratings";
import { NoteBox } from "../../everything-web/src/components/NoteCard";
import { NoteMenu } from "../../everything-web/src/components/NoteMenu";
import { VoteDonation } from "../../everything-web/src/components/VoteDonation";
import { takeMintedDonation, type MintedDonation } from "../../everything-web/src/lib/donations";
import { noteStatus, noteTallyVisible } from "../../everything-shared/noteScore";
import type { NoteRow } from "../../everything-shared/types";
import type { Vote } from "../../everything-shared/votes";

/** One votable note inside an extension overlay. It draws the box tinted by the
 *  note's status, the rating pills, the donation notice that appears after a
 *  vote, and the action row. The action row offers suggesting an improvement,
 *  saying that no note is needed, and sharing. This is the website's vote flow
 *  at popover size. Every note on a claim renders as its own box beside the
 *  others. */
export function NoteWithActions({ note, myVote, onVote, session, shareUrl, onNeedLogin, onAuthored, onNnnAuthored, onDeleted }: {
  note: NoteRow;
  myVote: Vote | undefined;
  /** Casts the vote and mints its donation. It resolves to the minted donation.
   *  It resolves to null when the vote is retracted, when the note is the
   *  viewer's own, and when nobody is signed in. */
  onVote: (note: NoteRow, vote: Vote) => Promise<MintedDonation | null>;
  session: Session | null;
  shareUrl: string;
  onNeedLogin: () => void;
  /** Called when an improvement has just been posted on this note. The handler
   *  mirrors the author's own vote on it and refreshes the group, so the new
   *  note appears. */
  onAuthored: (noteId: string) => void;
  /** A note-not-needed entry was just posted on this note's claim. */
  onNnnAuthored?: (entryId: string) => void;
  /** Called when this note has been deleted. The handler refreshes the group,
   *  because the extension gets no realtime updates. */
  onDeleted?: () => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // The donation that was just minted. It makes the notice appear beneath the
  // pills. A note the viewer just posted starts with the parked donation its
  // automatic Helpful vote minted, so the notice explains the pill that is
  // already lit. It is cleared when the vote is retracted, which leaves
  // myVote undefined, and when the notice closes itself.
  const [cast, setCast] = useState<MintedDonation | null>(() => takeMintedDonation(note.id));
  const status = noteStatus(note);
  return (
    <div>
      <NoteBox note={note} status={status} sourcesOpen={sourcesOpen}>
        <VoteRatings
          helpful={note.helpful_count}
          somewhatHelpful={note.somewhat_helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVote}
          showCounts={noteTallyVisible(status, myVote, note.created_at)}
          onVote={(vote) => void onVote(note, vote).then(setCast)}
        />
      </NoteBox>
      {cast && myVote !== undefined && session && (
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
        session={session}
        onNeedLogin={onNeedLogin}
        onAuthored={onAuthored}
        onNnnAuthored={onNnnAuthored ?? (() => {})}
        onDeleted={onDeleted}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
    </div>
  );
}
