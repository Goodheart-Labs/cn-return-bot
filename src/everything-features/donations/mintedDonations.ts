import type { MintedDonation } from "@cn/core/donations";

/* Posting a note mints a donation for the author's automatic Helpful vote,
 * but the note's card does not exist yet at that moment. The mint is parked
 * here under the note id, and the card claims it when it first renders, so
 * the donation notice appears under the fresh note the same way it would
 * after a click. The map never grows past a handful of entries, because every
 * render of a note card takes its entry out. */
const mintedByNote = new Map<string, MintedDonation>();

export const parkMintedDonation = (noteId: string, donation: MintedDonation) => mintedByNote.set(noteId, donation);

export function takeMintedDonation(noteId: string): MintedDonation | null {
  const donation = mintedByNote.get(noteId) ?? null;
  mintedByNote.delete(noteId);
  return donation;
}
