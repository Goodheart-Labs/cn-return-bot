import { useEffect, useRef, useState } from "react";
import type { ClaimRef, NnnRow, NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon } from "@cn/ui/icons";
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
            className="max-h-48 w-auto rounded-control border border-line object-contain"
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
    <div className={cn("text-2xs text-fg-muted", !bare && "border-l-2 border-line-strong pl-3")}>
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
            <strong className="font-semibold text-fg">{text.slice(idx, idx + quote.length)}</strong>
            {text.slice(idx + quote.length)}
          </>
        )}
      </div>
      {clampable && (
        <Button variant="link" className="mt-1 text-2xs" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
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
      className={cn(chipVariants(), "border-line text-link hover:bg-surface-hover")}
    >
      {direction === "up" ? <ArrowUpIcon size={13} aria-hidden /> : <ArrowDownIcon size={13} aria-hidden />}
      <PencilIcon size={11} aria-hidden />
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
      <Card ref={cardColRef} className="p-4 w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
      <div className="mb-3">
        {claim.image_urls.length > 0 && <ClaimImages urls={claim.image_urls} />}
        {paragraph && (
          <Button variant="link" className="xl:hidden text-xs mb-2" onClick={() => setCtxOpen((o) => !o)}>
            {ctxOpen ? "Hide surrounding context" : "Show surrounding context"}
          </Button>
        )}
        <ClaimContent content={claimContent(claim)} />
      </div>

      <Note note={note} shareUrl={shareUrl}>
        <ImprovementLinks note={note} improvements={improvements} />
      </Note>

      <NoteNotNeeded entries={nnnEntries} />
      </Card>
    </div>
  );
}
