import { originalsFirst } from "../../everything-shared/noteScore";
import { fetchNnnForClaims } from "../../everything-shared/noteNotNeeded";
import { fetchNotesForItem } from "../../everything-shared/notesQuery";
import type { NnnRow, NoteRow } from "../../everything-shared/types";

export type ClaimGroup = { claimId: string; notes: NoteRow[]; nnn: NnnRow[] };

/** Group an item's notes per claim (originals before improvements), each with
 *  the claim's note-not-needed entries. */
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

/** An item's notes + its claims' note-not-needed entries, grouped per claim.
 *  Shared by the Substack/generic inline mount and the YouTube overlay. */
export async function fetchClaimGroups(itemId: string): Promise<ClaimGroup[]> {
  const notes = await fetchNotesForItem(itemId);
  const nnn = await fetchNnnForClaims([...new Set(notes.map((n) => n.claim_id))]);
  return groupByClaim(notes, nnn);
}
