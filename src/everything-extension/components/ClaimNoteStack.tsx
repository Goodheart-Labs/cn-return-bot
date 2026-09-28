import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import type { ClaimGroup } from "../utils/claimGroups";
import { noteShareUrl } from "../utils/share";
import { Note } from "@cn/features/notes/Note";

/** The width every overlay uses. The Substack popover and the YouTube card are
 *  the same surface, so they get the same size. */
export const NOTE_POPOVER_WIDTH = 560;

/** The whole note surface of one claim. It shows the original note, the
 *  other notes on the claim in an indented rail, and the claim's
 *  note-not-needed list. The Substack popover and the YouTube overlay both use
 *  it, so the two cannot drift apart. */
export function ClaimNoteStack({ group, projectSlug }: { group: ClaimGroup; projectSlug: string | null }) {
  const [original, ...others] = group.notes;
  return (
    <>
      <Note note={original!} shareUrl={noteShareUrl(projectSlug, original!.id)} />
      {others.length > 0 && (
        <div className="mt-3 pl-3 border-l-4 border-line space-y-3">
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
