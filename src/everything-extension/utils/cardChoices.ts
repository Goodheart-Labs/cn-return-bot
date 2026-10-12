/** The reader's own open and close choices on a page's note cards, by claim
 *  id. True means the reader opened the card. False means the card is closed.
 *  A claim without an entry follows its display setting, which is how a
 *  helpful note's card opens by itself when the page loads.
 *
 *  A card that opened by itself closes only through its close button. After
 *  that it has an entry for good, so it behaves like every other card: the
 *  reader opens it, and a click elsewhere or opening another card closes it
 *  again. */
export type CardChoices = ReadonlyMap<string, boolean>;

/** Closes every card the reader opened. Each keeps its entry as false rather
 *  than losing it. Without an entry, a helpful note's card would open by
 *  itself again. */
export function closeCardsOpenedByReader(choices: CardChoices): CardChoices {
  return new Map([...choices.keys()].map((claimId) => [claimId, false]));
}

/** Opens one card. The reader sees one card of their own at a time, so every
 *  other card they opened closes. Cards that opened by themselves stay open. */
export function openCard(choices: CardChoices, claimId: string): CardChoices {
  return new Map(closeCardsOpenedByReader(choices)).set(claimId, true);
}
