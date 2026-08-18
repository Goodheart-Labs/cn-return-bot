import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import { LinkifiedText } from "../../../dashboard-shared/LinkifiedText";
import { VoteRatings } from "../../../dashboard-shared/Ratings";
import { quoteFragmentUrl } from "../../../dashboard-shared/textFragment";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NnnRow, NoteRow, NoteSourceDetail } from "../../../everything-shared/types";
import { fetchNoteSourceDetails } from "../../../everything-shared/notesQuery";
import type { MintedDonation } from "../lib/donations";
import type { Vote } from "../../../everything-shared/votes";
import { noteStatus, noteTallyVisible, type NoteStatus } from "../../../everything-shared/noteScore";
import { noteUrl } from "../lib/routing";
import { NoteMenu } from "./NoteMenu";
import { NoteNotNeeded, type NnnApi } from "./NoteNotNeeded";
import { VoteDonation } from "./VoteDonation";

/** The rating states, in the style of Community Notes. Each one carries the
 *  colour of its icon, the copy on its badge, the tint of the note box, and the
 *  question asked in the footer. The design sits halfway to X's own Community
 *  Notes grammar (Nathan, 2026-07-14). The badge and the wording are ours, and
 *  the vote row asks one plain question. */
const STATUS: Record<NoteStatus, { label: string; color: string; box: string; ask: string }> = {
  helpful: { label: "Currently rated helpful", color: "#22c55e", box: "bg-blue-50 border-blue-100 dark:bg-blue-950/50 dark:border-blue-900", ask: "Do you find this helpful?" },
  not_helpful: { label: "Currently rated not helpful", color: "#ef4444", box: "bg-gray-50 border-gray-200 dark:bg-gray-800/60 dark:border-gray-700", ask: "Do you find this helpful?" },
  needs_ratings: { label: "Needs more ratings", color: "#9ca3af", box: "bg-blue-50 border-blue-100 dark:bg-blue-950/50 dark:border-blue-900", ask: "Is this note helpful?" },
};

/** The status badge shown above a note. It is a filled circle followed by the
 *  Community Notes copy for that status. A status that has been decided also
 *  draws a ✓ or a ✕ inside the circle. */
export function StatusBadge({ status }: { status: NoteStatus }) {
  const { label, color } = STATUS[status];
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
      {/* The size is given in em so the icon scales with the font-size
          experiment. The cn-badge-* class lets a color scheme restyle the fills
          that are set inline here. */}
      <svg viewBox="0 0 20 20" width="1.05em" height="1.05em" aria-hidden className={`shrink-0 cn-badge-${status}`}>
        <circle cx="10" cy="10" r="10" fill={color} />
        {status === "helpful" && (
          <path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {status === "not_helpful" && (
          <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      <span>{label}</span>
    </div>
  );
}

/** Common Notes keeps a note's citations in a separate column. We append their
 *  URLs to the note text so they render as links inside it, the way the review
 *  dashboard and the stats dashboard render a note. */
function noteText(note: NoteRow): string {
  const urls = note.sources.map((s) => s.url);
  return urls.length > 0 ? `${note.note} ${urls.join(" ")}` : note.note;
}

/** The supporting quote and the explanation for each source, revealed by the
 *  "Show source details" button. The source URLs already sit inline in the note
 *  text, so this shows only the body of each citation. Each quote links out to
 *  that passage in the source.
 *
 *  The quotes are the largest thing a note carries and most readers never open
 *  this, so the feed loads without them and this fetches them the first time it
 *  is opened. It keeps them afterwards, so opening and closing costs one
 *  request. */
function SourceDetails({ open, noteId }: { open: boolean; noteId: string }) {
  const [detailed, setDetailed] = useState<NoteSourceDetail[]>([]);
  const requested = useRef(false);
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    fetchNoteSourceDetails(noteId).then(setDetailed);
  }, [open, noteId]);
  return (
    <div
      style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
      aria-hidden={!open}
    >
      <div className="overflow-hidden min-h-0">
        <div className="mt-3 space-y-3">
          {detailed.map((s, i) => (
            <div key={i}>
              <a href={quoteFragmentUrl(s.url, s.quote)} target="_blank" rel="noopener noreferrer" className="block group">
                <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 group-hover:border-blue-400 pl-3 text-gray-600 dark:text-gray-300 italic text-sm">“{s.quote}”</blockquote>
              </a>
              {s.explanation && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{s.explanation}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Maps a claim's context onto the shared ContentCard shape. A context URL that
 *  points at a video becomes a YouTube clip, embedded at the claim's timestamp
 *  span. Anything else becomes an article citation. The URL decides this, not
 *  item.source, so a podcast item whose context is a YouTube deep-link still
 *  renders as a clip.
 *
 *  The citation line is the verbatim `context_quote` excerpt. The `claim` column
 *  is not source text. It is a self-contained restatement, written so the claim
 *  can be fact-checked on its own. A claim grounded in an image has no excerpt,
 *  so it falls back to that restatement, which is rendered without quote marks
 *  and captioned as coming from the image. */
function claimContent(claim: ClaimRef): NotedContent {
  const url = claim.context_url;
  const quote = claim.context_quote || claim.claim;
  const fragmentText = claim.context_quote ? undefined : claim.claim;
  const imageGrounded = !claim.context_quote && (claim.image_urls?.length ?? 0) > 0;
  const updatedQuote = claim.updated_quote ?? undefined;
  if (url && /youtube\.com|youtu\.be/.test(url)) {
    return {
      kind: "youtube",
      url,
      quote,
      fragmentText,
      updatedQuote,
      imageGrounded,
      startSeconds: claim.start_seconds,
      endSeconds: claim.end_seconds,
    };
  }
  return { kind: "article", url, quote, fragmentText, updatedQuote, imageGrounded };
}

/** The images a claim is grounded in, which are usually Substack charts or
 *  screenshots. They sit above the claim's context. Each one links out to the
 *  full-resolution original. */
function ClaimImages({ urls }: { urls: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt="Claim source"
            loading="lazy"
            className="max-h-48 w-auto rounded-md border border-gray-200 object-contain"
          />
        </a>
      ))}
    </div>
  );
}

/** The paragraph surrounding the claim, with the quoted excerpt in bold. It sits
 *  beside the note card so the correction can be read in its original context. */
function ContextParagraph({ paragraph, quote, bare, fitTo }: {
  paragraph: string;
  quote: string;
  bare?: boolean;
  /** Clamps the paragraph to this element's height rather than to a fixed number
   *  of lines. The element is the note card beside it. A short context is not
   *  clamped at all and gets no button. Only a context that would grow taller
   *  than the card is folded (Nathan, 2026-07-14). */
  fitTo?: React.RefObject<HTMLDivElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [capPx, setCapPx] = useState<number | null>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const target = fitTo?.current;
    if (!target) return;
    const measure = () => {
      const cap = Math.max(160, target.offsetHeight - 28); // Leave room for the button.
      setCapPx(cap);
      // We can only judge overflow while the full paragraph is in the DOM. Once
      // it is clamped we render a slice of it, and the height of that slice says
      // nothing about the height of the whole paragraph.
      if (bodyRef.current && (expanded || !overflows)) {
        setOverflows(bodyRef.current.scrollHeight > cap + 12);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [fitTo, paragraph, expanded, overflows]);
  // We only fit to a height where there is a neighbouring card to measure
  // against, which is the side column at the xl breakpoint. The mobile rendering
  // sits behind its own "Show surrounding context" toggle. The reader asked for
  // the context there, so all of it is shown.
  const clampable = fitTo ? overflows : false;
  const fullIdx = paragraph.toLowerCase().indexOf(quote.toLowerCase());
  // When the paragraph is clamped, the visible window starts just before the
  // quote, so the bolded span is what the reader actually sees. Expanding it
  // restores the full paragraph.
  let text = paragraph;
  let idx = fullIdx;
  let ellipsis = false;
  if (clampable && !expanded && fullIdx > 140) {
    const start = paragraph.lastIndexOf(" ", fullIdx - 120) + 1;
    text = paragraph.slice(start);
    idx = fullIdx - start;
    ellipsis = true;
  }
  return (
    <div className={`cn-context text-xs text-gray-400 leading-relaxed ${bare ? "" : "border-l-4 border-gray-200 pl-3"}`}>
      <div
        ref={bodyRef}
        style={clampable && !expanded
          ? fitTo && capPx
            ? { maxHeight: capPx, overflow: "hidden" }
            : { display: "-webkit-box", WebkitLineClamp: 7, WebkitBoxOrient: "vertical", overflow: "hidden" }
          : undefined}
      >
        {ellipsis && "… "}
        {idx < 0 ? (
          text
        ) : (
          <>
            {text.slice(0, idx)}
            <strong className="font-semibold text-gray-800">{text.slice(idx, idx + quote.length)}</strong>
            {text.slice(idx + quote.length)}
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

/** The note as one self-contained unit, in the style of X's Community Notes. The
 *  rating-status badge sits on top, then the note text, then the rating pills,
 *  all inside the same box. The tint of the box follows the note's status. */
export function NoteBox({ note, status, sourcesOpen, children }: {
  note: NoteRow;
  status: NoteStatus;
  sourcesOpen?: boolean;
  children?: React.ReactNode;
}) {
  const by = note.author_id ? note.author_name ?? "anonymous" : null;
  return (
    <div className={`cn-notebox rounded-lg p-3 border ${STATUS[status].box}`}>
      <div className="-mx-3 px-3 pb-2 mb-3 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        {by && <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">by {by}</span>}
      </div>
      <LinkifiedText className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap" text={noteText(note)} />
      {note.has_source_details && <SourceDetails open={!!sourcesOpen} noteId={note.id} />}
      {children && (
        <div className="-mx-3 mt-3 px-3 pt-2.5 border-t border-gray-200/70 dark:border-gray-700/70 flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
          <span className="text-sm text-gray-700 dark:text-gray-300">{STATUS[status].ask}</span>
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">{children}</div>
        </div>
      )}
    </div>
  );
}

/** Scrolls to another note's card. If that card sits inside a collapsed
 *  <details> element, scrollIntoView silently does nothing, so we open the
 *  <details> first. */
function jumpToNote(noteId: string) {
  const el = document.getElementById(`note-${noteId}`);
  if (!el) return;
  el.closest("details")?.setAttribute("open", "");
  el.scrollIntoView({ block: "start", behavior: "smooth" });
}

const JUMP_ARROW_PROPS = {
  width: 13, height: 13, viewBox: "0 0 16 16",
  fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

/** An icon chip that scrolls to a related note. The explanation lives in the
 *  hover tooltip and in the aria-label, so the card itself stays quiet. */
function JumpChip({ targetNoteId, explain, direction, count }: {
  targetNoteId: string;
  explain: string;
  direction: "up" | "down";
  count?: number;
}) {
  return (
    <button
      onClick={() => jumpToNote(targetNoteId)}
      title={explain}
      aria-label={explain}
      className="inline-flex items-center gap-1 h-6 px-1.5 rounded-full border border-gray-200 text-[11px] font-semibold text-blue-600 hover:bg-gray-100"
    >
      <svg {...JUMP_ARROW_PROPS} aria-hidden>
        {direction === "up"
          ? <><path d="M8 13V3" /><path d="M4 7l4-4 4 4" /></>
          : <><path d="M8 3v10" /><path d="M4 9l4 4 4-4" /></>}
      </svg>
      <svg {...JUMP_ARROW_PROPS} width={11} height={11} viewBox="0 0 24 24" aria-hidden>
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </svg>
      {count !== undefined && count > 1 && count}
    </button>
  );
}

/** The jump-links between an improvement and the note it improves. They are the
 *  only tie left between the two now that every note renders as its own card.
 *  The links are icons alone, and hovering one explains it. They sit in the
 *  note's action row, in the slot NoteMenu leaves between Share and the ⋯
 *  button. */
function ImprovementLinks({ note, improvements }: { note: NoteRow; improvements: NoteRow[] }) {
  if (!note.improved_from_note_id && improvements.length === 0) return null;
  return (
    <span className="inline-flex gap-1.5">
      {note.improved_from_note_id && (
        <JumpChip
          targetNoteId={note.improved_from_note_id}
          direction="up"
          explain="This note is a suggested improvement of another note — jump to the original"
        />
      )}
      {improvements.length > 0 && (
        <JumpChip
          targetNoteId={improvements[0]!.id}
          direction="down"
          count={improvements.length}
          explain={
            improvements.length === 1
              ? "Someone suggested an improved version of this note — jump to it"
              : `${improvements.length} suggested improvements of this note — jump to the first`
          }
        />
      )}
    </span>
  );
}

// Composed the same way as a card in the review dashboard. The content comes
// first, then the note, then the stats row. Here the voting is live and the
// reader can suggest an improvement.
export function NoteCard({ note, improvements, nnnEntries, nnnApi, projectSlug, myVote, onVote, onAuthored, session, onNeedLogin }: {
  note: NoteRow;
  /** The notes that improve this one. This is the reverse of
   *  improved_from_note_id. */
  improvements: NoteRow[];
  /** The claim's note-not-needed entries, oldest first. Every note on the same
   *  text shares this list. */
  nnnEntries: NnnRow[];
  nnnApi: NnnApi;
  projectSlug: string;
  myVote: Vote | undefined;
  /** Casts the vote and mints its donation. It resolves to the minted donation,
   *  which carries the vote id, the charity and the frozen pair. It resolves to
   *  null when the vote was retracted, when it was cast on the user's own note,
   *  or when something failed. */
  onVote: (note: NoteRow, vote: Vote) => Promise<MintedDonation | null>;
  /** Called when this user has just posted a note. The caller mirrors the note's
   *  automatic self-vote into its local state. */
  onAuthored: (noteId: string) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [ctxOpen, setCtxOpen] = useState(false);
  // Set right after a vote is cast. It holds the donation just minted, and its
  // presence is what shows the donation notice beneath the rating pills. The
  // charity on it is the value in the ledger, and a successful redirect updates
  // it here too. Retracting the vote clears it.
  const [cast, setCast] = useState<MintedDonation | null>(null);
  const cardColRef = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // The status is computed once per card. The badge, the box tint, the reveal of
  // the counts and the donation payout all read this same value.
  const status = noteStatus(note);
  const claim = note.claim;
  // A stored context_paragraph always contains its context_quote word for word.
  // Ingest enforces that, not this component. It is why the bolding below always
  // finds its span.
  const paragraph = claim?.context_paragraph;
  const quoteInParagraph = claim?.context_quote ?? claim?.claim ?? "";
  return (
    <div id={`note-${note.id}`} className="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-5 items-start">
      {paragraph && claim && (
        <div className="hidden xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} fitTo={cardColRef} />
        </div>
      )}
      {paragraph && claim && (
        <div
          className="xl:hidden w-full max-w-[40rem] mx-auto"
          style={{ display: "grid", gridTemplateRows: ctxOpen ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
          aria-hidden={!ctxOpen}
        >
          <div className="overflow-hidden min-h-0">
            <div className="mb-2">
              <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} bare />
            </div>
          </div>
        </div>
      )}
      <div ref={cardColRef} className="bg-white rounded-lg border border-gray-200 p-4 w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
      {claim && (
        <div className="mb-3">
          {claim.image_urls?.length > 0 && <ClaimImages urls={claim.image_urls} />}
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
      </div>

      <NoteMenu
        note={note}
        shareUrl={noteUrl(projectSlug, note.id)}
        session={session}
        onNeedLogin={onNeedLogin}
        onAuthored={onAuthored}
        onNnnAuthored={nnnApi.onAuthored}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      >
        <ImprovementLinks note={note} improvements={improvements} />
      </NoteMenu>

      <NoteNotNeeded entries={nnnEntries} api={nnnApi} session={session} />
      </div>
    </div>
  );
}
