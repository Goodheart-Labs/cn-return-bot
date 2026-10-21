import { useRef, useState, type ReactNode } from "react";
import type { FeedItemRow, NnnRow, NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon } from "@cn/ui/icons";
import { Note } from "@cn/features/notes/Note";
import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import { ContextParagraph } from "@cn/features/notes/ContextParagraph";
import { ClaimContent, claimContent } from "./ClaimContent";

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
export function FeedNoteCard({ note, byline, post, improvements, nnnEntries, shareUrl }: {
  note: NoteRow;
  /** A line at the top of the card. The All notes page names the note's
   *  creator there, because its feed mixes every creator's notes. */
  byline?: ReactNode;
  /** The post the note is on. The project's All page passes it, so each card
   *  names its post. A page for one post leaves it out, because the page's
   *  heading already names the post. */
  post?: FeedItemRow;
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
      {byline && <div className="mb-3">{byline}</div>}
      <div className="mb-4">
        {claim.image_urls.length > 0 && <ClaimImages urls={claim.image_urls} />}
        {paragraph && (
          <Button variant="link" className="xl:hidden text-xs mb-2" onClick={() => setCtxOpen((o) => !o)}>
            {ctxOpen ? "Hide surrounding context" : "Show surrounding context"}
          </Button>
        )}
        <ClaimContent content={claimContent(claim, post)} />
      </div>

      <Note note={note} shareUrl={shareUrl}>
        <ImprovementLinks note={note} improvements={improvements} />
      </Note>

      <NoteNotNeeded entries={nnnEntries} />
      </Card>
    </div>
  );
}
