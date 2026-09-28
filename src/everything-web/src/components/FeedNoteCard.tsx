import { useEffect, useRef, useState } from "react";
import type { ClaimRef, NnnRow, NoteRow } from "@cn/core/types";
import { CARD, CHIP, LINK, QUOTE_RAIL } from "@cn/ui/classes";
import { Note } from "@cn/features/notes/Note";
import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import { ClaimContent, type NotedContent } from "./ClaimContent";

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
            className="max-h-48 w-auto rounded-lg border border-gray-200 dark:border-gray-700 object-contain"
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
    <div className={`cn-context text-xs text-gray-400 dark:text-gray-500 leading-relaxed ${bare ? "" : QUOTE_RAIL}`}>
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
            <strong className="font-semibold text-gray-800 dark:text-gray-200">{text.slice(idx, idx + quote.length)}</strong>
            {text.slice(idx + quote.length)}
          </>
        )}
      </div>
      {clampable && (
        <button onClick={() => setExpanded((e) => !e)} className={`mt-1 text-xs ${LINK}`}>
          {expanded ? "Show less" : "Show more"}
        </button>
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
      className={`${CHIP} border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800`}
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
    <span className="inline-flex gap-1">
      {note.improved_from_note_id && (
        <JumpChip
          targetNoteId={note.improved_from_note_id}
          direction="up"
          explain="This note is a suggested improvement of another note. Jump to the original"
        />
      )}
      {improvements.length > 0 && (
        <JumpChip
          targetNoteId={improvements[0]!.id}
          direction="down"
          count={improvements.length}
          explain={
            improvements.length === 1
              ? "Someone suggested an improved version of this note. Jump to it"
              : `${improvements.length} suggested improvements of this note. Jump to the first`
          }
        />
      )}
    </span>
  );
}

/** One card of the website's feed: the claim in its source, the note on it,
 *  and the claim's note-not-needed list. On a wide screen the paragraph around
 *  the claim sits beside the card. */
export function FeedNoteCard({ note, improvements, nnnEntries, shareUrl }: {
  note: NoteRow;
  /** The notes that improve this one. This is the reverse of
   *  improved_from_note_id. */
  improvements: NoteRow[];
  /** The claim's note-not-needed entries, oldest first. Every note on the same
   *  text shares this list. */
  nnnEntries: NnnRow[];
  /** The absolute deep link the Share button copies. */
  shareUrl: string;
}) {
  const [ctxOpen, setCtxOpen] = useState(false);
  const cardColRef = useRef<HTMLDivElement>(null);
  const claim = note.claim;
  // A stored context_paragraph always contains its context_quote word for word.
  // Ingest enforces that, not this component. It is why the bolding below always
  // finds its span.
  const paragraph = claim.context_paragraph;
  const quoteInParagraph = claim.context_quote ?? claim.claim;
  return (
    <div id={`note-${note.id}`} className="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-4 items-start">
      {paragraph && (
        <div className="hidden xl:block xl:col-start-1 xl:row-start-1">
          <ContextParagraph paragraph={paragraph} quote={quoteInParagraph} fitTo={cardColRef} />
        </div>
      )}
      {paragraph && (
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
      <div ref={cardColRef} className={`${CARD} p-4 w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1`}>
      <div className="mb-3">
        {claim.image_urls.length > 0 && <ClaimImages urls={claim.image_urls} />}
        {paragraph && (
          <button
            onClick={() => setCtxOpen((o) => !o)}
            className={`xl:hidden text-xs mb-2 ${LINK}`}
          >
            {ctxOpen ? "Hide surrounding context" : "Show surrounding context"}
          </button>
        )}
        <ClaimContent content={claimContent(claim)} />
      </div>

      <Note note={note} shareUrl={shareUrl}>
        <ImprovementLinks note={note} improvements={improvements} />
      </Note>

      <NoteNotNeeded entries={nnnEntries} />
      </div>
    </div>
  );
}
