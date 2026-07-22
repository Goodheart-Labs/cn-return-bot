import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { VoteRatings } from "../../dashboard-shared/Ratings";
import { NoteBox } from "../../everything-web/src/components/NoteCard";
import { NoteMenu } from "../../everything-web/src/components/NoteMenu";
import { VoteDonation } from "../../everything-web/src/components/VoteDonation";
import type { MintedDonation } from "../../everything-web/src/lib/donations";
import { noteStatus, noteTallyVisible } from "../../everything-shared/noteScore";
import type { NoteRow } from "../../everything-shared/types";
import type { Vote } from "../../everything-shared/votes";

/** One votable note in an extension overlay: status-tinted box, rating pills,
 *  the post-vote donation notice, and the action row (improve /
 *  note-not-needed / share) — the website's vote flow, popover-sized. Every
 *  note on a claim renders as its own peer box. */
export function NoteWithActions({ note, myVote, onVote, session, shareUrl, onNeedLogin, onAuthored, onNnnAuthored }: {
  note: NoteRow;
  myVote: Vote | undefined;
  /** Casts the vote and mints its donation; resolves to the minted donation,
   *  or null on retract / own note / signed out. */
  onVote: (note: NoteRow, vote: Vote) => Promise<MintedDonation | null>;
  session: Session | null;
  shareUrl: string;
  onNeedLogin: () => void;
  /** An improvement was just posted on this note (mirror its self-vote and
   *  refresh the group so it appears). */
  onAuthored: (noteId: string) => void;
  /** A note-not-needed entry was just posted on this note's claim. */
  onNnnAuthored?: (entryId: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // The just-minted donation — shows the notice beneath the pills; cleared on
  // retract (myVote goes undefined) or when the notice dismisses itself.
  const [cast, setCast] = useState<MintedDonation | null>(null);
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
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
    </div>
  );
}
