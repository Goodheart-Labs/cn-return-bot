import { queryOptions } from "@tanstack/react-query";
import { fetchNnnForClaims } from "@cn/core/noteNotNeeded";
import { fetchNotesForItem } from "@cn/core/notes";
import { noteStatus, originalsFirst } from "@cn/core/noteScore";
import type { ClaimRef, NnnRow, NoteRow } from "@cn/core/types";
import { noteSetOf, type NoteSet } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import type { NoteFilters } from "./settings";

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
 *  note-not-needed entries. */
export type ClaimGroup = { claimId: string; claim: ClaimRef; notes: NoteRow[]; nnn: NnnRow[] };

/** Whether the reader's note filters let this note render. A note rated
 *  helpful always shows. */
export function noteVisible(note: NoteRow, filters: NoteFilters): boolean {
  const status = noteStatus(note);
  if (status === "needs_ratings") return filters.showNeedsRatings;
  if (status === "not_helpful") return filters.showUnhelpful;
  return true;
}

/** The claims of a page whose notes pass the reader's filters, each with its
 *  visible notes, original first. */
export function claimGroups({ notes, nnn }: NoteSet, filters: NoteFilters): ClaimGroup[] {
  const byClaim = new Map<string, NoteRow[]>();
  for (const note of notes.values()) {
    if (!noteVisible(note, filters)) continue;
    byClaim.set(note.claim_id, [...(byClaim.get(note.claim_id) ?? []), note]);
  }
  return [...byClaim].map(([claimId, claimNotes]) => ({
    claimId,
    claim: claimNotes[0]!.claim,
    notes: claimNotes.sort(originalsFirst),
    nnn: [...nnn.values()].filter((e) => e.claim_id === claimId),
  }));
}

/** The note tallies for the count card and the popup. `helpful`,
 *  `needsRatings` and `notHelpful` are disjoint, so "1 Common Note, 1 needs
 *  more ratings" means one helpful note plus one unrated one. All three count
 *  every note on the page, deliberately ignoring the reader's filters: counts
 *  report what exists, filters only decide what renders. `visible` is the
 *  filtered count, the notes a jump can actually reach. */
export type NoteCounts = { helpful: number; needsRatings: number; notHelpful: number; visible: number };

export function noteCounts(notes: Iterable<NoteRow>, filters: NoteFilters): NoteCounts {
  const counts = { helpful: 0, needsRatings: 0, notHelpful: 0, visible: 0 };
  for (const note of notes) {
    const status = noteStatus(note);
    if (status === "helpful") counts.helpful += 1;
    else if (status === "needs_ratings") counts.needsRatings += 1;
    else counts.notHelpful += 1;
    if (noteVisible(note, filters)) counts.visible += 1;
  }
  return counts;
}
