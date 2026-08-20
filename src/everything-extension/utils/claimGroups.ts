import { noteStatus, originalsFirst } from "../../everything-shared/noteScore";
import { fetchNnnForClaims } from "../../everything-shared/noteNotNeeded";
import { fetchNotesForItem } from "../../everything-shared/notesQuery";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { getNoteFilters, type NoteFilters } from "./settings";

export type ClaimGroup = { claimId: string; notes: NoteRow[]; nnn: NnnRow[] };

/** Group an item's notes by claim, with an original note before any
 *  improvements to it. Each group also carries that claim's note-not-needed
 *  entries. */
function groupByClaim(notes: NoteRow[], nnn: NnnRow[]): ClaimGroup[] {
  const byId = new Map<string, NoteRow[]>();
  for (const note of notes) {
    if (!note.claim) continue;
    const list = byId.get(note.claim_id);
    if (list) list.push(note);
    else byId.set(note.claim_id, [note]);
  }
  return [...byId.entries()].map(([claimId, group]) => ({
    claimId,
    notes: [...group].sort(originalsFirst),
    nnn: nnn.filter((e) => e.claim_id === claimId),
  }));
}

/** Whether the popup's filter tickboxes let this note render. A note rated
 *  helpful always shows. */
export function noteVisible(note: NoteRow, filters: NoteFilters): boolean {
  const status = noteStatus(note);
  if (status === "needs_ratings") return filters.showNeedsRatings;
  if (status === "not_helpful") return filters.showUnhelpful;
  return true;
}

/** The note tallies for the count card. `helpful` and `needsRatings` are
 *  disjoint, so "1 Common Note, 1 needs more ratings" means one helpful note
 *  plus one unrated one. Both are counted over ALL of the item's notes,
 *  deliberately ignoring the reader's display filters: counts report what
 *  exists, filters only decide what renders. `visible` is the filtered count,
 *  the notes a jump can actually reach. */
export type NoteCounts = { helpful: number; needsRatings: number; visible: number };

/** An item's notes and its claims' note-not-needed entries, grouped by claim,
 *  with the status filters applied, plus the visible-note counts. Both the
 *  inline mount, used on Substack and on the generic text sites, and the
 *  YouTube overlay call this. */
export async function fetchClaimGroups(itemId: string): Promise<{ groups: ClaimGroup[]; counts: NoteCounts }> {
  const [notes, filters] = await Promise.all([fetchNotesForItem(itemId), getNoteFilters()]);
  const visible = notes.filter((note) => noteVisible(note, filters));
  const counts = { helpful: 0, needsRatings: 0, visible: visible.length };
  for (const note of notes) {
    const status = noteStatus(note);
    if (status === "helpful") counts.helpful += 1;
    else if (status === "needs_ratings") counts.needsRatings += 1;
  }
  const nnn = await fetchNnnForClaims([...new Set(visible.map((n) => n.claim_id))]);
  return { groups: groupByClaim(visible, nnn), counts };
}
