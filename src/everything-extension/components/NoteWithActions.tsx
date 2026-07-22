import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { VoteRatings } from "../../dashboard-shared/Ratings";
import { NoteBox } from "../../everything-web/src/components/NoteCard";
import { NoteMenu } from "../../everything-web/src/components/NoteMenu";
import { noteStatus, noteTallyVisible } from "../../everything-shared/noteScore";
import type { NoteRow } from "../../everything-shared/types";
import type { Vote } from "../../everything-shared/votes";

/** One votable note in an extension overlay: status-tinted box, rating pills,
 *  and the action row (improve / note-not-needed / share). Every note on a
 *  claim renders as its own peer box — improvements are their own notes, they
 *  don't replace the original. */
export function NoteWithActions({ note, myVote, onVote, session, shareUrl, onNeedLogin, onAuthored }: {
  note: NoteRow;
  myVote: Vote | undefined;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  shareUrl: string;
  onNeedLogin: () => void;
  /** An improvement was just posted on this note (mirror its self-vote and
   *  refresh the group so it appears). */
  onAuthored: (noteId: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
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
          onVote={(vote) => onVote(note, vote)}
        />
      </NoteBox>
      <NoteMenu
        note={note}
        shareUrl={shareUrl}
        session={session}
        onNeedLogin={onNeedLogin}
        onAuthored={onAuthored}
        onNnnAuthored={() => {}}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
    </div>
  );
}
