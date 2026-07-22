import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import { LinkifiedText } from "../../../dashboard-shared/LinkifiedText";
import { VoteRatings } from "../../../dashboard-shared/Ratings";
import { quoteFragmentUrl } from "../../../dashboard-shared/textFragment";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NnnRow, NoteRow, NoteSourceRow } from "../../../everything-shared/types";
import type { MintedDonation } from "../lib/donations";
import type { Vote } from "../../../everything-shared/votes";
import { noteStatus, noteTallyVisible, type NoteStatus } from "../../../everything-shared/noteScore";
import { noteUrl } from "../lib/routing";
import { NoteMenu } from "./NoteMenu";
import { NoteNotNeeded, type NnnApi } from "./NoteNotNeeded";
import { VoteDonation } from "./VoteDonation";

/** Community-Notes rating states: icon, copy, box tint, and the footer ask.
 *  Halfway to X-CN grammar (Nathan, 2026-07-14): our own badge + wording, but
 *  the vote row is a one-verb ask and shown notes carry a trust line. */
const STATUS: Record<NoteStatus, { label: string; color: string; box: string; ask: string }> = {
  helpful: { label: "Currently rated helpful", color: "#22c55e", box: "bg-blue-50 border-blue-100", ask: "Do you find this helpful?" },
  not_helpful: { label: "Currently rated not helpful", color: "#ef4444", box: "bg-gray-50 border-gray-200", ask: "Do you find this helpful?" },
  needs_ratings: { label: "Needs more ratings", color: "#9ca3af", box: "bg-blue-50 border-blue-100", ask: "Is this note helpful?" },
};

/** The status badge shown above a note: a filled circle (with a ✓/✕ glyph for
 *  the decided states) and its Community-Notes copy. */
export function StatusBadge({ status }: { status: NoteStatus }) {
  const { label, color } = STATUS[status];
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
      {/* em-sized so the icon scales with the font-size experiment; the
          cn-badge-* class lets color schemes restyle the inline fills */}
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

/** Common Notes keeps citations in a separate column; append them so they
 *  render as linkified URLs inline in the note text, like the review/stats
 *  dashboards. */
function noteText(note: NoteRow): string {
  const urls = note.sources.map((s) => s.url);
  return urls.length > 0 ? `${note.note} ${urls.join(" ")}` : note.note;
}

/** Does any source carry a supporting quote worth a details reveal? */
function hasSourceDetails(sources: NoteSourceRow[]): boolean {
  return sources.some((s) => s.quote);
}

/** Per-source supporting quote + explanation, revealed by "Show source
 *  details". The source URLs already sit inline in the note text, so this
 *  shows only the citation body (deep-linked quote + explanation). */
function SourceDetails({ open, sources }: { open: boolean; sources: NoteSourceRow[] }) {
  const detailed = [...sources].sort((a, b) => a.sort_order - b.sort_order).filter((s) => s.quote);
  return (
    <div
      style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
      aria-hidden={!open}
    >
      <div className="overflow-hidden min-h-0">
        <div className="mt-3 space-y-3">
          {detailed.map((s, i) => (
            <div key={i}>
              <a href={quoteFragmentUrl(s.url, s.quote!)} target="_blank" rel="noopener noreferrer" className="block group">
                <blockquote className="border-l-4 border-gray-300 group-hover:border-blue-400 pl-3 text-gray-600 italic text-sm">“{s.quote}”</blockquote>
              </a>
              {s.explanation && <p className="mt-1 text-xs text-gray-500">{s.explanation}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Map a claim's context to the shared ContentCard shape: a YouTube clip when
 *  the context URL is a video (embedded at its timestamp span), else an
 *  article citation. Decided by URL, not item.source — a podcast item with a
 *  YouTube deep-link renders as a clip.
 *
 *  The citation line is the verbatim `context_quote` excerpt — the `claim`
 *  column is a self-contained restatement written for isolated fact-checking,
 *  not source text. An image-grounded claim has no excerpt and falls back to
 *  the restated claim, rendered unquoted with an image-sourced caption. */
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

/** Images a claim is grounded in (Substack charts / screenshots), shown above
 *  its context. Each links out to the full-resolution source. */
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

/** The claim's surrounding paragraph, with the quoted excerpt bolded. Shown
 *  beside the note card so the correction can be read in its original context. */
function ContextParagraph({ paragraph, quote, bare, fitTo }: {
  paragraph: string;
  quote: string;
  bare?: boolean;
  /** Clamp to this element's height (the note card beside us) instead of a
   *  fixed line count — short contexts get no clamp/button at all; only ones
   *  that would outgrow the card fold (Nathan, 2026-07-14). */
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
      const cap = Math.max(160, target.offsetHeight - 28); // leave room for the button
      setCapPx(cap);
      // Only re-judge overflow while the FULL paragraph is in the DOM — once
      // clamped we render a slice, whose height says nothing about the whole.
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
  // Height-fit only where a neighboring card exists to measure against (the
  // xl side column). The mobile rendering sits behind its own "Show
  // surrounding context" toggle — the reader asked for it, show all of it.
  const clampable = fitTo ? overflows : false;
  const fullIdx = paragraph.toLowerCase().indexOf(quote.toLowerCase());
  // When clamped, open the window just before the quote so the bolded span is
  // what the reader actually sees; expanding restores the full paragraph.
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

/** The note as one self-contained unit, X-CN style: a rating-status badge on
 *  top, the note text, and the rating pills inside the same box; the box tint
 *  follows the status (helpful/needs-ratings/not-helpful). */
export function NoteBox({ note, status, sourcesOpen, children }: {
  note: NoteRow;
  status: NoteStatus;
  sourcesOpen?: boolean;
  children?: React.ReactNode;
}) {
  const by = note.author_id ? note.author_name ?? "anonymous" : null;
  return (
    <div className={`cn-notebox rounded-lg p-3 border ${STATUS[status].box}`}>
      <div className="-mx-3 px-3 pb-2 mb-3 border-b border-gray-200/70 flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        {by && <span className="text-xs text-gray-500 shrink-0">by {by}</span>}
      </div>
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={noteText(note)} />
      {hasSourceDetails(note.sources) && <SourceDetails open={!!sourcesOpen} sources={note.sources} />}
      {children && (
        <div className="-mx-3 mt-3 px-3 pt-2.5 border-t border-gray-200/70 flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
          <span className="text-sm text-gray-700">{STATUS[status].ask}</span>
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">{children}</div>
        </div>
      )}
    </div>
  );
}

/** Scroll to another note's card. The target may sit inside the collapsed
 *  "rated unhelpful" <details> drawer, where scrollIntoView silently no-ops —
 *  open it first. */
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

/** Icon chip that scrolls to a related note; the explanation lives in the
 *  hover tooltip (title) + aria-label so the card stays quiet. */
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

/** Jump-links between an improvement and its original — the only remaining tie
 *  between them now that every note is its own card. Icon-only; hover explains.
 *  Rides in the note's action row (NoteMenu slot, between Share and ⋯). */
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

// Mirrors the review-dashboard card composition: content → note → stats row,
// with voting live and an improve-note affordance.
export function NoteCard({ note, improvements, nnnEntries, nnnApi, projectSlug, myVote, onVote, onAuthored, session, onNeedLogin }: {
  note: NoteRow;
  /** Notes that improve this one (reverse of improved_from_note_id). */
  improvements: NoteRow[];
  /** The claim's note-not-needed entries, oldest first — shared by every note
   *  on the same text. */
  nnnEntries: NnnRow[];
  nnnApi: NnnApi;
  projectSlug: string;
  myVote: Vote | undefined;
  /** Casts the vote and mints its donation; resolves to the minted donation
   *  (vote id + charity + frozen pair), or null on retract / own note / error. */
  onVote: (note: NoteRow, vote: Vote) => Promise<MintedDonation | null>;
  /** A note was just posted by this user (mirror its auto-upvote locally). */
  onAuthored: (noteId: string) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [ctxOpen, setCtxOpen] = useState(false);
  // Set right after casting a vote — the just-minted donation, which shows the
  // donation notice beneath the pills. Its charity is the ledger's value; a
  // successful redirect updates it here. Cleared on retract.
  const [cast, setCast] = useState<MintedDonation | null>(null);
  const cardColRef = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // One evaluation per card: the badge tint, the counts reveal and the donation
  // payout all read the same status.
  const status = noteStatus(note);
  const claim = note.claim;
  // Data invariant (enforced at ingest, NOT here): a stored context_paragraph
  // always contains its context_quote word-for-word, so the bold always lands.
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
