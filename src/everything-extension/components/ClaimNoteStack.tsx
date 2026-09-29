import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import { Note } from "@cn/features/notes/Note";
import { NextIcon } from "@cn/ui/icons";
import type { ClaimGroup } from "../utils/claimGroups";
import { noteShareUrl } from "../utils/share";

/** The width every overlay uses. The Substack popover and the YouTube card are
 *  the same surface, so they get the same size. */
export const NOTE_POPOVER_WIDTH = 560;

/** Where the claim sits among the page's claims, and how to move on to the
 *  next one. Positions count from 1. */
export interface NoteNavigation {
  position: number;
  total: number;
  onNext: () => void;
}

/** The claim's place among the page's claims. It sits in the card's top bar,
 *  opposite the close button, and clicking it moves on to the next claim. A
 *  page with one claim has nowhere to move on to, so the button is left out. */
export function NextNoteButton({ position, total, onNext }: NoteNavigation) {
  if (total <= 1) return null;
  return (
    <button
      type="button"
      onClick={onNext}
      aria-label={`Next note. This is note ${position} of ${total}`}
      className="-ml-1.5 inline-flex h-6 items-center gap-0.5 rounded-control px-1.5 text-sm tabular-nums text-fg-muted hover:bg-surface-hover hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {position} of {total}
      <NextIcon size={14} aria-hidden />
    </button>
  );
}

/** The whole note surface of one claim. It shows the original note, the
 *  other notes on the claim indented under a thin rail, and the claim's
 *  note-not-needed list. The Substack popover and the YouTube overlay both
 *  use it, so the two cannot drift apart. */
export function ClaimNoteStack({ group, projectSlug }: {
  group: ClaimGroup;
  projectSlug: string | null;
}) {
  const [original, ...others] = group.notes;
  return (
    <>
      <Note note={original!} shareUrl={noteShareUrl(projectSlug, original!.id)} />
      {others.length > 0 && (
        <div className="mt-4 space-y-4 border-l-2 border-line pl-4">
          {others.map((note) => (
            <Note key={note.id} note={note} shareUrl={noteShareUrl(projectSlug, note.id)} />
          ))}
        </div>
      )}
      {/* The list is keyed to the claim, just as it is on the website, so it
          belongs to every note above. */}
      <NoteNotNeeded entries={group.nnn} />
    </>
  );
}
