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

// Mirrors the review-dashboard card composition: content → note → stats row,
// with voting live and an improve-note affordance.
export function NoteCard({ note, projectSlug, suggestions, myVote, onVote, session, onNeedLogin }: {
  note: NoteRow;
  projectSlug: string;
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
  // Common Notes stores citations in a separate column; the X pipeline keeps
  // them inline in the note text. Append them so they render as linkified URLs
  // exactly like the review/stats dashboards.
  const noteBody = latestImprovement?.suggested_text ?? note.note;
  const noteText = note.sources.length > 0 ? `${noteBody} ${note.sources.join(" ")}` : noteBody;

  const paragraph = claim?.context_paragraph;
  return (
    <div id={`note-${note.id}`} className="scroll-mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] gap-3 md:gap-5 items-start">
      {paragraph && claim && (
        <div className="order-2 md:order-1 md:col-start-1 md:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={claim.context_quote} />
        </div>
      )}
      <div className="bg-white rounded-lg border border-gray-200 p-4 order-1 md:order-2 md:col-start-2 md:row-start-1 w-full">
      {claim && (
        <div className="mb-3">
          <ContentCard content={claimContent(claim)} />
        </div>
      )}

      <OurNoteCard noteText={noteText} className="mb-3" />

      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <VoteRatings
          helpful={note.helpful_count}
          somewhatHelpful={note.somewhat_helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVote}
          onVote={(vote) => onVote(note, vote)}
        />
        <ImproveNote noteId={note.id} session={session} onNeedLogin={onNeedLogin} />
        <ShareButton projectSlug={projectSlug} noteId={note.id} />
      </div>
      </div>
    </div>
  );
}
