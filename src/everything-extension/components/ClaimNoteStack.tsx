import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import type { ClaimGroup } from "../utils/claimGroups";
import { noteShareUrl } from "../utils/share";
import { Note } from "@cn/features/notes/Note";

/** The width every overlay uses. The Substack popover and the YouTube card are
 *  the same surface, so they get the same size. */
export const NOTE_POPOVER_WIDTH = 560;

/** The group-of-people glyph from Material Symbols, named "groups". It is our
 *  community marker and is drawn in a 24 by 24 viewBox. Both marker surfaces use
 *  this one path: the Substack badge and the pin on YouTube's scrub bar. */
export const GROUP_GLYPH_PATH = "M0 18v-1.575q0-1.1 1.1-1.763T4 14q.325 0 .625.013t.575.062q-.35.525-.525 1.1T4.5 16.4V18Zm6 0v-1.6q0-.8.438-1.463t1.237-1.162Q8.475 13.275 9.55 13T12 12.725q1.375 0 2.45.275t1.875.775q.8.5 1.238 1.163T18 16.4V18Zm13.5 0v-1.6q0-.65-.163-1.225t-.487-1.075q.275-.05.563-.075T20 14q1.8 0 2.9.663t1.1 1.762V18ZM4 13q-.825 0-1.412-.588T2 11q0-.85.588-1.425T4 9q.85 0 1.425.575T6 11q0 .825-.575 1.413T4 13Zm16 0q-.825 0-1.413-.588T18 11q0-.85.588-1.425T20 9q.85 0 1.425.575T22 11q0 .825-.575 1.413T20 13Zm-8-1q-1.25 0-2.125-.875T9 9q0-1.275.875-2.138T12 6q1.275 0 2.138.863T15 9q0 1.25-.862 2.125T12 12Z";

export function GroupIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d={GROUP_GLYPH_PATH} />
    </svg>
  );
}

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
        <div className="mt-3 pl-3 border-l-4 border-gray-200 dark:border-gray-700 space-y-3">
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
