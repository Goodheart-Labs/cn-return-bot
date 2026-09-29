import { useEffect, useState } from "react";
import { noteStatus } from "@cn/core/noteScore";
import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import { Note } from "@cn/features/notes/Note";
import { Button } from "@cn/ui/Button";
import { NextIcon } from "@cn/ui/icons";
import type { ClaimGroup } from "../utils/claimGroups";
import { updateNoteDisplay } from "../utils/settings";
import { noteShareUrl } from "../utils/share";
import { countUnhelpfulNotesSeen } from "../utils/unhelpfulOffer";

/** The width every overlay uses. The Substack popover and the YouTube card are
 *  the same surface, so they get the same size. */
export const NOTE_POPOVER_WIDTH = 560;

/** Where the open claim sits among the page's claims, and how to move on to
 *  the next one. Positions count from 1. */
export interface NoteNavigation {
  position: number;
  total: number;
  onNext: () => void;
}

/** The id of the unhelpful note in this card that should carry the "Don't
 *  show me unhelpful notes anymore" link, or null. Counted once per opened
 *  card, see utils/unhelpfulOffer.ts. */
function useHideUnhelpfulOffer(group: ClaimGroup): string | null {
  const [offerNoteId, setOfferNoteId] = useState<string | null>(null);
  useEffect(() => {
    const unhelpful = group.notes.filter((note) => noteStatus(note) === "not_helpful");
    if (unhelpful.length === 0) return;
    void countUnhelpfulNotesSeen(unhelpful.length).then((index) => setOfferNoteId(index === null ? null : unhelpful[index]!.id));
    // Counted when the card opens for a claim. A vote that changes a note's
    // status while the card is open does not count it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.claimId]);
  return offerNoteId;
}

/** One note, plus the hide link when this note carries it. */
function StackedNote({ note, projectSlug, offersHideUnhelpful }: { note: ClaimGroup["notes"][number]; projectSlug: string | null; offersHideUnhelpful: boolean }) {
  return (
    <div>
      <Note note={note} shareUrl={noteShareUrl(projectSlug, note.id)} />
      {offersHideUnhelpful && (
        <Button variant="quiet" className="mt-2 text-sm" onClick={() => void updateNoteDisplay({ not_helpful: "hide" })}>
          Don't show me unhelpful notes anymore
        </Button>
      )}
    </div>
  );
}

/** The whole note surface of one claim. It shows the original note, the
 *  other notes on the claim indented under a thin rail, and the claim's
 *  note-not-needed list. Above them sits the way on to the page's next noted
 *  claim. The Substack popover and the YouTube overlay both use it, so the
 *  two cannot drift apart. */
export function ClaimNoteStack({ group, projectSlug, navigation }: {
  group: ClaimGroup;
  projectSlug: string | null;
  navigation: NoteNavigation;
}) {
  const [original, ...others] = group.notes;
  const offerNoteId = useHideUnhelpfulOffer(group);
  return (
    <>
      {navigation.total > 1 && (
        <div className="mb-3 flex items-center justify-between text-sm text-fg-muted">
          <span>
            {navigation.position} of {navigation.total}
          </span>
          <Button variant="link" className="flex items-center gap-0.5 text-sm" onClick={navigation.onNext}>
            Next note
            <NextIcon size={16} aria-hidden />
          </Button>
        </div>
      )}
      <StackedNote note={original!} projectSlug={projectSlug} offersHideUnhelpful={original!.id === offerNoteId} />
      {others.length > 0 && (
        <div className="mt-4 space-y-4 border-l-2 border-line pl-4">
          {others.map((note) => (
            <StackedNote key={note.id} note={note} projectSlug={projectSlug} offersHideUnhelpful={note.id === offerNoteId} />
          ))}
        </div>
      )}
      {/* The list is keyed to the claim, just as it is on the website, so it
          belongs to every note above. */}
      <NoteNotNeeded entries={group.nnn} />
    </>
  );
}
