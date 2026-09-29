// Open cards that would overlap are pushed down, with this much space between.
const MARGIN_CARD_STACK_GAP = 12;
// A card that opens by itself does so only when it lands at most this far
// below its passage. Further down it would sit beside unrelated text, so its
// claim keeps just its dot until the reader opens it.
const DEFAULT_OPEN_MAX_DRIFT = 200;
// The height assumed for a card that has not been measured yet. It keeps the
// first layout close to the final one, so cards do not appear and then vanish.
const UNMEASURED_CARD_HEIGHT = 320;

/** Which margin cards are on screen, and at what top. Each card starts level
 *  with its passage, and a card that would overlap the one above it is pushed
 *  down below it. A card the reader opened is always placed. A card that
 *  would open by itself is placed only if that push leaves it close to its
 *  passage. */
export function placeMarginCards(
  cards: { claimId: string; passageTop: number; openedByReader: boolean }[],
  heights: ReadonlyMap<string, number>,
): Map<string, number> {
  const tops = new Map<string, number>();
  let previousBottom = -Infinity;
  for (const { claimId, passageTop, openedByReader } of [...cards].sort((a, b) => a.passageTop - b.passageTop)) {
    const top = Math.max(passageTop, previousBottom + MARGIN_CARD_STACK_GAP);
    if (!openedByReader && top - passageTop > DEFAULT_OPEN_MAX_DRIFT) continue;
    tops.set(claimId, top);
    previousBottom = top + (heights.get(claimId) ?? UNMEASURED_CARD_HEIGHT);
  }
  return tops;
}
