import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import { OurNoteCard } from "../../../dashboard-shared/OurNoteCard";
import { VoteRatings } from "../../../dashboard-shared/Ratings";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NoteRow, SuggestionRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { ImproveNote } from "./ImproveNote";

/** Map a claim's context to the shared ContentCard shape: a YouTube clip when
 *  the context URL is a video (embedded at its timestamp span), else an
 *  article citation. Decided by URL, not item.source — a podcast item with a
 *  YouTube deep-link renders as a clip. */
function claimContent(claim: ClaimRef): NotedContent {
  const url = claim.context_url;
  if (url && /youtube\.com|youtu\.be/.test(url)) {
    return {
      kind: "youtube",
      url,
      quote: claim.context_quote,
      startSeconds: claim.start_seconds,
      endSeconds: claim.end_seconds,
    };
  }
  return { kind: "article", url, quote: claim.context_quote };
}

// Mirrors the review-dashboard card composition: content → note → stats row,
// with voting live and an improve-note affordance.
export function NoteCard({ note, suggestions, myVote, onVote, session, onNeedLogin }: {
  note: NoteRow;
  suggestions: SuggestionRow[];
  myVote: Vote | undefined;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const claim = note.claim;
  // An accepted community improvement replaces the note text in the UI only
  // (the DB note is untouched). Newest accepted edit wins.
  const latestImprovement = suggestions
    .filter((s) => s.status === "accepted")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const noteText = latestImprovement?.suggested_text ?? note.note;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {claim && (
        <div className="mb-3">
          <ContentCard content={claimContent(claim)} />
        </div>
      )}

      <OurNoteCard noteText={noteText} showHeader={false} className="mb-3" />

      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <VoteRatings
          helpful={note.helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVote}
          onVote={(vote) => onVote(note, vote)}
        />
        <ImproveNote noteId={note.id} session={session} onNeedLogin={onNeedLogin} />
      </div>
    </div>
  );
}
