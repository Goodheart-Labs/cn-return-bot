/* Where margin notes go, shared by the extension and the minisite reader, so
 * both lay out their margin the same way. */

/** The box of a margin marker, in pixels. The dot is drawn smaller inside it. */
export const MARKER_SIZE = 20;
// Two markers whose words start on the same line would overlap, so later ones
// are nudged down by one marker height plus this much breathing room.
const MARKER_GAP = 6;
// Open cards that would overlap are pushed down, with this much space between.
const MARGIN_CARD_STACK_GAP = 12;
// A card that opens by itself does so only when it lands at most this far
// below its passage. Further down it would sit beside unrelated text, so its
// claim keeps just its dot until the reader opens it.
const DEFAULT_OPEN_MAX_DRIFT = 200;
// The height assumed for a card that has not been measured yet. It keeps the
// first layout close to the final one, so cards do not appear and then vanish.
const UNMEASURED_CARD_HEIGHT = 320;

type MarginCard = { claimId: string; passageTop: number; openedByReader: boolean };
type Span = { top: number; bottom: number };

/** The first top at or below `top` where a card of this height overlaps none
 *  of the spans. The spans are sorted from top to bottom. */
function firstFreeTop(top: number, height: number, taken: readonly Span[]): number {
  let free = top;
  for (const span of taken) {
    if (free < span.bottom + MARGIN_CARD_STACK_GAP && free + height + MARGIN_CARD_STACK_GAP > span.top) free = span.bottom + MARGIN_CARD_STACK_GAP;
  }
  return free;
}

/** Which margin cards are on screen, and at what top. The cards the reader
 *  opened go first, each level with its own passage, pushed down only by
 *  another card the reader opened. Then every other card starts level with
 *  its passage and moves down below the card above it and below any card the
 *  reader opened that is in its way. Such a card is placed only if that push
 *  leaves it close to its passage. So a card in the way of the one the reader
 *  just opened closes to its marker, however many cards there are. */
export function placeMarginCards(cards: MarginCard[], heights: ReadonlyMap<string, number>): Map<string, number> {
  const heightOf = (claimId: string) => heights.get(claimId) ?? UNMEASURED_CARD_HEIGHT;
  const byTop = [...cards].sort((a, b) => a.passageTop - b.passageTop);
  const tops = new Map<string, number>();
  const opened: Span[] = [];
  let previousBottom = -Infinity;
  for (const { claimId, passageTop } of byTop.filter((card) => card.openedByReader)) {
    const top = Math.max(passageTop, previousBottom + MARGIN_CARD_STACK_GAP);
    tops.set(claimId, top);
    previousBottom = top + heightOf(claimId);
    opened.push({ top, bottom: previousBottom });
  }
  previousBottom = -Infinity;
  for (const { claimId, passageTop } of byTop.filter((card) => !card.openedByReader)) {
    const top = firstFreeTop(Math.max(passageTop, previousBottom + MARGIN_CARD_STACK_GAP), heightOf(claimId), opened);
    if (top - passageTop > DEFAULT_OPEN_MAX_DRIFT) continue;
    tops.set(claimId, top);
    previousBottom = top + heightOf(claimId);
  }
  return tops;
}

/** The top of each marker. Each starts level with its words, and one that
 *  would overlap the marker above it is pushed down below it. */
export function placeMarkers<K>(markers: { key: K; top: number }[]): Map<K, number> {
  const tops = new Map<K, number>();
  let previousBottom = -Infinity;
  for (const { key, top } of [...markers].sort((a, b) => a.top - b.top)) {
    const placed = Math.max(top, previousBottom + MARKER_GAP);
    tops.set(key, placed);
    previousBottom = placed + MARKER_SIZE;
  }
  return tops;
}
