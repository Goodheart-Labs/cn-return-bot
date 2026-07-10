import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import { LinkifiedText } from "../../../dashboard-shared/LinkifiedText";
import { VoteRatings } from "../../../dashboard-shared/Ratings";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NoteRow, SuggestionRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { noteUrl } from "../lib/routing";
import { ImproveNote } from "./ImproveNote";
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
function ContextParagraph({ paragraph, quote, bare }: { paragraph: string; quote: string; bare?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const clampable = paragraph.length > 700;
  const idx = paragraph.toLowerCase().indexOf(quote.toLowerCase());
  return (
    <div className={`text-sm text-gray-600 leading-relaxed ${bare ? "" : "border-l-4 border-gray-200 pl-3"}`}>
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

/** The note as one self-contained unit, X-CN style: a status header on top,
 *  the note text, and the rating pills inside the same box. Blue = locked
 *  ("real") note, transparent purple = draft still collecting ratings. */
function NoteBox({ noteText, locked, header, children }: {
  noteText: string;
  locked: boolean;
  header: string;
  children?: React.ReactNode;
}) {
  const boxCls = locked ? "bg-blue-50 border-blue-100" : "bg-purple-100/40 border-purple-200";
  return (
    <div className={`rounded-lg p-3 border ${boxCls}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-2">
        <span aria-hidden>👥</span>
        <span>{header}</span>
      </div>
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={noteText} />
      {children && <div className="mt-3 flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">{children}</div>}
    </div>
  );
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
    <NoteBox
      noteText={note.note}
      locked={false}
      header={`Draft note by ${note.author_name ?? "anonymous"} · collecting ratings`}
    >
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
    </NoteBox>
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
  const [ctxOpen, setCtxOpen] = useState(false);
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
  const header = locked
    ? "Common Notes users thought this was something you wanted to see"
    : "Draft note · collecting ratings";
  return (
    <div id={`note-${note.id}`} className="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] xl:gap-5 items-start">
      {paragraph && claim && (
        <div className="hidden xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={claim.context_quote} />
        </div>
      )}
      {paragraph && claim && (
        <div
          className="xl:hidden w-full max-w-xl mx-auto"
          style={{ display: "grid", gridTemplateRows: ctxOpen ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
          aria-hidden={!ctxOpen}
        >
          <div className="overflow-hidden min-h-0">
            <div className="mb-2">
              <ContextParagraph paragraph={paragraph} quote={claim.context_quote} bare />
            </div>
          </div>
        </div>
      )}
      <div className="bg-white rounded-lg border border-gray-200 p-4 w-full max-w-xl mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
      {claim && (
        <div className="mb-3">
          {paragraph && (
            <button
              onClick={() => setCtxOpen((o) => !o)}
              className="xl:hidden text-xs text-blue-600 hover:underline mb-2"
            >
              {ctxOpen ? "Hide surrounding context" : "Show surrounding context"}
            </button>
          )}
          <ContentCard content={claimContent(claim)} />
        </div>
      )}

      <div className="mb-2">
        <NoteBox noteText={noteText} locked={locked} header={header}>
          <VoteRatings
            helpful={note.helpful_count}
            somewhatHelpful={note.somewhat_helpful_count}
            notHelpful={note.not_helpful_count}
            myVote={myVote}
            onVote={(vote) => onVote(note, vote)}
          />
          {voteHolds.has(note.id) && <ResortCountdown key={`${note.helpful_count}-${note.somewhat_helpful_count}-${note.not_helpful_count}`} />}
        </NoteBox>
      </div>

      <div className="mb-2 flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
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
      </div>
    </div>
  );
}
