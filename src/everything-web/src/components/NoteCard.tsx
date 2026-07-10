import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import { OurNoteCard } from "../../../dashboard-shared/OurNoteCard";
import { VoteRatings } from "../../../dashboard-shared/Ratings";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NoteRow, SuggestionRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { noteUrl } from "../lib/routing";
import { ImproveNote } from "./ImproveNote";
import { WriteNote } from "./WriteNote";
import { supabase } from "../lib/supabase";

/** Six-second draining circle shown right after a vote: the note holds its
 *  place until this empties, so a misclick can be fixed before it re-sorts. */
function ResortCountdown() {
  return (
    <span className="inline-flex items-center" title="Hold — re-sorting shortly; click again to change your vote">
      <svg width="14" height="14" viewBox="0 0 16 16" className="-rotate-90">
        <circle cx="8" cy="8" r="7" fill="none" stroke="#e5e7eb" strokeWidth="2" />
        <circle cx="8" cy="8" r="7" fill="none" stroke="#3b82f6" strokeWidth="2"
          strokeDasharray="44" style={{ animation: "cn-countdown 6s linear forwards" }} />
      </svg>
    </span>
  );
}

function ShareButton({ projectSlug, noteId }: { projectSlug: string; noteId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(noteUrl(projectSlug, noteId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

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

/** The claim's surrounding paragraph, with the quoted excerpt bolded. Shown
 *  beside the note card so the correction can be read in its original context. */
function ContextParagraph({ paragraph, quote }: { paragraph: string; quote: string }) {
  const [expanded, setExpanded] = useState(false);
  const clampable = paragraph.length > 700;
  const idx = paragraph.toLowerCase().indexOf(quote.toLowerCase());
  return (
    <div className="text-sm text-gray-600 leading-relaxed border-l-4 border-gray-200 pl-3">
      <div
        style={clampable && !expanded
          ? { display: "-webkit-box", WebkitLineClamp: 14, WebkitBoxOrient: "vertical", overflow: "hidden" }
          : undefined}
      >
        {idx < 0 ? (
          paragraph
        ) : (
          <>
            {paragraph.slice(0, idx)}
            <strong className="font-semibold text-gray-900">{paragraph.slice(idx, idx + quote.length)}</strong>
            {paragraph.slice(idx + quote.length)}
          </>
        )}
      </div>
      {clampable && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs text-blue-600 hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** CN-style status derived live from the vote counts (no stored status):
 *  under 5 ratings a note is still collecting; past that the weighted score
 *  (somewhat = 0.5) decides. */
function RatingStatusBadge({ note }: { note: NoteRow }) {
  const total = note.helpful_count + note.somewhat_helpful_count + note.not_helpful_count;
  let label = "Draft · collecting ratings";
  let cls = "bg-gray-100 text-gray-600 border-gray-200";
  if (total >= 5) {
    const score = (note.helpful_count + 0.5 * note.somewhat_helpful_count) / total;
    if (score >= 0.6) {
      label = "Rated helpful";
      cls = "bg-green-100 text-green-800 border-green-200";
    } else if (score < 0.4) {
      label = "Rated not helpful";
      cls = "bg-red-100 text-red-800 border-red-200";
    } else {
      label = "Needs more ratings";
    }
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

/** A user-written draft note: attributed, votable, deletable by its author. */
function DraftNote({ note, myVote, onVote, session, holdActive }: {
  note: NoteRow;
  myVote: Vote | undefined;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  holdActive?: boolean;
}) {
  const mine = session?.user.id === note.author_id;
  const remove = async () => {
    await supabase.from("everything_notes").delete().eq("id", note.id);
  };
  return (
    <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          Draft note by <span className="font-medium text-gray-700">{note.author_name ?? "anonymous"}</span>
        </span>
        <RatingStatusBadge note={note} />
      </div>
      <OurNoteCard noteText={note.note} className="bg-white border-gray-200" />
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <VoteRatings
          helpful={note.helpful_count}
          somewhatHelpful={note.somewhat_helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVote}
          onVote={(vote) => onVote(note, vote)}
        />
        {holdActive && <ResortCountdown />}
        {mine && (
          <button onClick={remove} className="text-xs text-gray-400 hover:text-red-600 hover:underline">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Mirrors the review-dashboard card composition: content → note → stats row,
// with voting live and an improve-note affordance.
export function NoteCard({ note, locked, draftNotes, projectSlug, suggestions, myVotes, voteHolds, onVote, session, onNeedLogin }: {
  note: NoteRow;
  locked: boolean;
  draftNotes: NoteRow[];
  projectSlug: string;
  suggestions: SuggestionRow[];
  myVotes: Map<string, Vote>;
  voteHolds: Map<string, boolean>;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const myVote = myVotes.get(note.id);
  const claim = note.claim;
  // An accepted community improvement replaces the note text in the UI only
  // (the DB note is untouched). Newest accepted edit wins.
  const latestImprovement = suggestions
    .filter((s) => s.status === "accepted")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  // Common Notes stores citations in a separate column; the X pipeline keeps
  // them inline in the note text. Append them so they render as linkified URLs
  // exactly like the review/stats dashboards.
  const noteBody = latestImprovement?.suggested_text ?? note.note;
  const noteText = note.sources.length > 0 ? `${noteBody} ${note.sources.join(" ")}` : noteBody;

  const paragraph = claim?.context_paragraph;
  return (
    <div id={`note-${note.id}`} className="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] xl:gap-5 items-start">
      {paragraph && claim && (
        <div className="hidden xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={claim.context_quote} />
        </div>
      )}
      <div className="bg-white rounded-lg border border-gray-200 p-4 w-full max-w-xl mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
      {claim && (
        <div className="mb-3">
          <ContentCard content={claimContent(claim)} />
          {paragraph && (
            <details className="xl:hidden mt-2">
              <summary className="text-xs text-blue-600 cursor-pointer select-none">Show surrounding context</summary>
              <div className="mt-2">
                <ContextParagraph paragraph={paragraph} quote={claim.context_quote} />
              </div>
            </details>
          )}
        </div>
      )}

      <OurNoteCard noteText={noteText} className={locked ? "mb-3" : "!bg-purple-100/40 !border-purple-200 mb-3"} />

      <div className="mb-2 flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <RatingStatusBadge note={note} />
        <VoteRatings
          helpful={note.helpful_count}
          somewhatHelpful={note.somewhat_helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVote}
          onVote={(vote) => onVote(note, vote)}
        />
        {voteHolds.has(note.id) && <ResortCountdown key={`${note.helpful_count}-${note.somewhat_helpful_count}-${note.not_helpful_count}`} />}
        <ImproveNote noteId={note.id} session={session} onNeedLogin={onNeedLogin} />
        <ShareButton projectSlug={projectSlug} noteId={note.id} />
      </div>

      {draftNotes.length > 0 && (
        <div className="space-y-2 mb-2">
          {draftNotes.map((d) => (
            <DraftNote key={d.id} note={d} myVote={myVotes.get(d.id)} onVote={onVote} session={session} holdActive={voteHolds.has(d.id)} />
          ))}
        </div>
      )}
      {claim && <WriteNote claimId={claim.id} session={session} onNeedLogin={onNeedLogin} />}
      </div>
    </div>
  );
}
