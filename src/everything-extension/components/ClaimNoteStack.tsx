import type { Session } from "@supabase/supabase-js";
import { NoteNotNeeded, type NnnApi } from "../../everything-web/src/components/NoteNotNeeded";
import type { Vote } from "../../everything-shared/votes";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { noteShareUrl } from "../utils/share";
import { LoginPanel } from "./LoginPanel";
import { NoteWithActions } from "./NoteWithActions";

/** The width every overlay uses. The Substack popover and the YouTube card are
 *  the same surface, so they get the same size. */
export const NOTE_POPOVER_WIDTH = 560;

/** Spread this onto the outermost wrapper of an overlay. It keeps our keyboard
 *  events from reaching the host page. Shadow retargeting makes the page see
 *  those events as coming from the shadow host element rather than from an
 *  input, so the page's own "ignore typing" checks never fire. Without this,
 *  YouTube's single-key shortcuts such as k, f, m, the digits and the arrow keys
 *  would drive the player while somebody types in a composer. */
export const ABSORB_KEYS = {
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  onKeyUp: (e: React.KeyboardEvent) => e.stopPropagation(),
  onKeyPress: (e: React.KeyboardEvent) => e.stopPropagation(),
} as const;

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

/** The whole note surface of one claim. It shows the primary note, the peer
 *  alternatives in an indented rail, and the claim's note-not-needed list. The
 *  vote wiring is the website's. The Substack popover and the YouTube overlay
 *  both use it, so the two cannot drift apart. */
export function ClaimNoteStack({ group, projectSlug, session, myVotes, onVote, onNeedLogin, onAuthored, onNnnAuthored, onDeleted, nnnApi }: {
  group: { primary: NoteRow; alternatives: NoteRow[]; nnn: NnnRow[] };
  projectSlug: string | null;
  session: Session | null;
  myVotes: Map<string, Vote>;
  onVote: React.ComponentProps<typeof NoteWithActions>["onVote"];
  onNeedLogin: () => void;
  onAuthored: (noteId: string) => void;
  onNnnAuthored: (entryId: string) => void;
  onDeleted: () => void;
  nnnApi: NnnApi;
}) {
  const noteProps = (note: NoteRow) => ({
    note,
    myVote: myVotes.get(note.id),
    onVote,
    session,
    shareUrl: noteShareUrl(projectSlug, note.id),
    onNeedLogin,
    onAuthored,
    onNnnAuthored,
    onDeleted,
  });
  return (
    <>
      <NoteWithActions {...noteProps(group.primary)} />
      {group.alternatives.length > 0 && (
        <div className="mt-3 pl-3 border-l-4 border-gray-200 dark:border-gray-700 space-y-3">
          {group.alternatives.map((d) => (
            <NoteWithActions key={d.id} {...noteProps(d)} />
          ))}
        </div>
      )}
      {/* The list is keyed to the claim, just as it is on the website, so it
          belongs to every note above. */}
      <NoteNotNeeded entries={group.nnn} api={nnnApi} session={session} />
    </>
  );
}

/** The login form inside an overlay, shown above the note stack when a
 *  signed-out reader tries to vote or write. It replaced a hint that sent
 *  people off to the toolbar icon; now they sign in right here and their vote
 *  is one more click away. Both overlays use it unchanged. */
export function OverlayLogin({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
      <LoginPanel surface="overlay" onDismiss={onDismiss} />
    </div>
  );
}
