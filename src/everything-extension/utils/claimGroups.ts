import { queryOptions } from "@tanstack/react-query";
import { fetchNnnForClaims } from "@cn/core/noteNotNeeded";
import { fetchNotesForItem } from "@cn/core/notes";
import { noteStatus, originalsFirst, type NoteStatus } from "@cn/core/noteScore";
import type { ClaimRef, NnnRow, NoteRow } from "@cn/core/types";
import { noteSetOf, type NoteSet } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import type { NoteDisplay, NoteDisplaySettings } from "./settings";

/** The query for one page's notes and the note-not-needed entries on their
 *  claims. The overlays read it from the shared query cache, so a vote or a
 *  new note updates every overlay on the page. */
export const itemNoteSetQuery = (itemId: string) =>
  queryOptions({
    queryKey: queryKeys.itemNoteSet(itemId),
    queryFn: async (): Promise<NoteSet> => {
      const notes = await fetchNotesForItem(itemId);
      return noteSetOf(notes, await fetchNnnForClaims([...new Set(notes.map((n) => n.claim_id))]));
    },
  });

/** The notes on one claim with the original first, and that claim's
 *  note-not-needed entries. `status` is the best status among those notes,
 *  which is the colour the claim's marker draws in. `display` is the most
 *  prominent display choice among them, which decides how the claim shows:
 *  a claim with one open note is open. Never "hide", because a claim whose
 *  notes are all hidden is left out. */
export type ClaimGroup = {
  claimId: string;
  claim: ClaimRef;
  notes: NoteRow[];
  nnn: NnnRow[];
  status: NoteStatus;
  display: Exclude<NoteDisplay, "hide">;
};

/** Statuses from best to worst. A claim holding a helpful note is marked as
 *  helpful, even when a second note on it still needs ratings. */
const STATUS_RANK: NoteStatus[] = ["helpful", "needs_ratings", "not_helpful"];

/** Display choices from most to least prominent. */
const DISPLAY_RANK = ["open", "collapse", "dot"] as const;

/** The claims of a page that have at least one note the reader has not
 *  hidden, each with those notes, original first. */
export function claimGroups({ notes, nnn }: NoteSet, display: NoteDisplaySettings): ClaimGroup[] {
  const byClaim = new Map<string, NoteRow[]>();
  for (const note of notes.values()) {
    if (display[noteStatus(note)] === "hide") continue;
    byClaim.set(note.claim_id, [...(byClaim.get(note.claim_id) ?? []), note]);
  }
  return [...byClaim].map(([claimId, claimNotes]) => {
    const statuses = claimNotes.map(noteStatus);
    const displays = statuses.map((status) => display[status]);
    return {
      claimId,
      claim: claimNotes[0]!.claim,
      notes: claimNotes.sort(originalsFirst),
      nnn: [...nnn.values()].filter((e) => e.claim_id === claimId),
      status: STATUS_RANK.find((status) => statuses.includes(status))!,
      display: DISPLAY_RANK.find((level) => displays.includes(level))!,
    };
  });
}

/** The note tallies for the popup. `helpful`, `needsRatings` and `notHelpful`
 *  are disjoint, so "1 Common Note, 1 needs more ratings" means one helpful
 *  note plus one unrated one. All three count every note on the page,
 *  deliberately ignoring the reader's display choices: counts report what
 *  exists. `visible` counts the notes that are not hidden, which are the
 *  notes a jump can actually reach. */
export type NoteCounts = { helpful: number; needsRatings: number; notHelpful: number; visible: number };

export function noteCounts(notes: Iterable<NoteRow>, display: NoteDisplaySettings): NoteCounts {
  const counts = { helpful: 0, needsRatings: 0, notHelpful: 0, visible: 0 };
  for (const note of notes) {
    const status = noteStatus(note);
    if (status === "helpful") counts.helpful += 1;
    else if (status === "needs_ratings") counts.needsRatings += 1;
    else counts.notHelpful += 1;
    if (display[status] !== "hide") counts.visible += 1;
  }
  return counts;
}
