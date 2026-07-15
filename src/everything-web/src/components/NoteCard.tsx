import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import { LinkifiedText } from "../../../dashboard-shared/LinkifiedText";
import { VoteRatings } from "../../../dashboard-shared/Ratings";
import { quoteFragmentUrl } from "../../../dashboard-shared/textFragment";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NoteRow, NoteSourceRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { noteStatus, type NoteStatus } from "../lib/noteScore";
import { NoteMenu } from "./NoteMenu";

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
function StatusBadge({ status }: { status: NoteStatus }) {
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

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Does any source carry a supporting quote worth a details reveal? */
function hasSourceDetails(sources: NoteSourceRow[]): boolean {
  return sources.some((s) => s.quote);
}

/** The note's source links, always inline below the note text. Each deep-links
 *  to its supporting quote (#:~:text=) when one was extracted, else the URL. */
function SourceLinks({ sources }: { sources: NoteSourceRow[] }) {
  const ordered = [...sources].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div className="mt-3 pt-3 border-t border-gray-200/70 flex flex-wrap gap-x-3 gap-y-1">
      {ordered.map((s, i) => (
        <a
          key={i}
          href={s.quote ? quoteFragmentUrl(s.url, s.quote) : s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline break-all"
        >
          {hostname(s.url)} ↗
        </a>
      ))}
    </div>
  );
}

/** Per-source supporting quote + explanation, revealed by "Show source
 *  details". The source links themselves already sit inline above, so this
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

/** Map a claim's context to the shared ContentCard shape: a YouTube clip when
 *  the context URL is a video (embedded at its timestamp span), else an
 *  article citation. Decided by URL, not item.source — a podcast item with a
 *  YouTube deep-link renders as a clip.
 *
 *  The citation line is the verbatim `claim` (word-for-word source text, per
 *  the #247 convention) and renders quoted; a claim that is NOT a substring of
 *  its own context_quote (e.g. a table-derived or legacy paraphrased anchor)
 *  falls back to the unquoted style, with the deep-link targeting the
 *  verbatim `context_quote` passage instead. */
function claimContent(claim: ClaimRef): NotedContent {
  const url = claim.context_url;
  const quote = claim.context_quote ?? "";
  const verbatim = quote.toLowerCase().includes(claim.claim.toLowerCase());
  const fragmentText = verbatim || !quote ? undefined : quote;
  const updatedQuote = claim.updated_quote ?? undefined;
  if (url && /youtube\.com|youtu\.be/.test(url)) {
    return {
      kind: "youtube",
      url,
      quote: claim.claim,
      fragmentText,
      updatedQuote,
      startSeconds: claim.start_seconds,
      endSeconds: claim.end_seconds,
    };
  }
  return { kind: "article", url, quote: claim.claim, fragmentText, updatedQuote };
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
function NoteBox({ note, sourcesOpen, children }: {
  note: NoteRow;
  sourcesOpen?: boolean;
  children?: React.ReactNode;
}) {
  const status = noteStatus(note);
  const by = note.author_id ? note.author_name ?? "anonymous" : null;
  return (
    <div className={`cn-notebox rounded-lg p-3 border ${STATUS[status].box}`}>
      <div className="-mx-3 px-3 pb-2 mb-3 border-b border-gray-200/70 flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        {by && <span className="text-xs text-gray-500 shrink-0">by {by}</span>}
      </div>
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={note.note} />
      {note.sources.length > 0 && <SourceLinks sources={note.sources} />}
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

/** An alternative note nested under the promoted one — a lower-scoring
 *  improvement or the original AI note it outscored. Votable and carrying the
 *  same ⋯ menu (delete shows only to its author); if it climbs above the
 *  promoted note it swaps up to the top on the next render. */
function AlternativeNote({ note, myVote, onVote, session, holdActive, projectSlug, onNeedLogin }: {
  note: NoteRow;
  myVote: Vote | undefined;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  holdActive?: boolean;
  projectSlug: string;
  onNeedLogin: () => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  return (
    <div>
      <NoteBox note={note} sourcesOpen={sourcesOpen}>
        <VoteRatings
          helpful={note.helpful_count}
          somewhatHelpful={note.somewhat_helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVote}
          onVote={(vote) => onVote(note, vote)}
        />
        {holdActive && <ResortCountdown />}
      </NoteBox>
      <NoteMenu
        note={note}
        projectSlug={projectSlug}
        session={session}
        onNeedLogin={onNeedLogin}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
    </div>
  );
}

// Mirrors the review-dashboard card composition: content → note → stats row,
// with voting live and an improve-note affordance.
export function NoteCard({ note, draftNotes, projectSlug, myVotes, voteHolds, onVote, session, onNeedLogin }: {
  note: NoteRow;
  draftNotes: NoteRow[];
  projectSlug: string;
  myVotes: Map<string, Vote>;
  voteHolds: Map<string, boolean>;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const myVote = myVotes.get(note.id);
  const [ctxOpen, setCtxOpen] = useState(false);
  const cardColRef = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const claim = note.claim;
  // Data invariant (enforced at import + by the audit sweep, NOT here): a
  // stored context_paragraph always contains its claim, so the bold always
  // lands. Paragraphs that can't situate the quote are deleted, not hidden.
  const paragraph = claim?.context_paragraph;
  return (
    <div id={`note-${note.id}`} className="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] xl:gap-5 items-start">
      {paragraph && claim && (
        <div className="hidden xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={claim.claim} fitTo={cardColRef} />
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
              <ContextParagraph paragraph={paragraph} quote={claim.claim} bare />
            </div>
          </div>
        </div>
      )}
      <div ref={cardColRef} className="bg-white rounded-lg border border-gray-200 p-4 w-full max-w-xl mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
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
        <NoteBox note={note} sourcesOpen={sourcesOpen}>
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

      <NoteMenu
        note={note}
        projectSlug={projectSlug}
        session={session}
        onNeedLogin={onNeedLogin}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />

      {/* Alternatives (improvements + any note this one outscored) nest here,
          Reddit-style: indented behind a rail, ranked, swapping in live. */}
      {draftNotes.length > 0 && (
        <div className="mt-3 pl-3 sm:pl-4 border-l-[3px] border-gray-300 space-y-3">
          {draftNotes.map((d) => (
            <AlternativeNote
              key={d.id}
              note={d}
              myVote={myVotes.get(d.id)}
              onVote={onVote}
              session={session}
              holdActive={voteHolds.has(d.id)}
              projectSlug={projectSlug}
              onNeedLogin={onNeedLogin}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
