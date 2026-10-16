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
export const UNMEASURED_CARD_HEIGHT = 320;

type MarginCard = { claimId: string; passageTop: number; openedByReader: boolean };
/** A stretch of the margin a card covers, from its top to its bottom. */
export type Span = { top: number; bottom: number };

/** The first top at or below `top` where something of this height, with
 *  `gap` around it, overlaps none of the spans. */
function firstFreeTop(top: number, height: number, taken: readonly Span[], gap: number): number {
  let free = top;
  for (const span of [...taken].sort((a, b) => a.top - b.top)) {
    if (free < span.bottom + gap && free + height + gap > span.top) free = span.bottom + gap;
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
    const top = firstFreeTop(Math.max(passageTop, previousBottom + MARGIN_CARD_STACK_GAP), heightOf(claimId), opened, MARGIN_CARD_STACK_GAP);
    if (top - passageTop > DEFAULT_OPEN_MAX_DRIFT) continue;
    tops.set(claimId, top);
    previousBottom = top + heightOf(claimId);
  }
  return tops;
}

/** The top of each marker. Each starts level with its words, and one that
 *  would overlap the marker above it is pushed down below it. A marker that
 *  would sit under an open card, given in `cards`, moves below that card, so
 *  no marker is ever hidden. */
export function placeMarkers<K>(markers: { key: K; top: number }[], cards: readonly Span[] = []): Map<K, number> {
  const tops = new Map<K, number>();
  let previousBottom = -Infinity;
  for (const { key, top } of [...markers].sort((a, b) => a.top - b.top)) {
    const placed = firstFreeTop(Math.max(top, previousBottom + MARKER_GAP), MARKER_SIZE, cards, MARKER_GAP);
    tops.set(key, placed);
    previousBottom = placed + MARKER_SIZE;
  }
  return tops;
}

/** How an entry of the margin column shows: `opened` by the reader, `closed`
 *  by the reader, or `auto` when the reader has not touched it. */
export type ColumnMode = "opened" | "closed" | "auto";

export interface ColumnEntry<K> {
  key: K;
  /** The top of the entry's words. */
  anchor: number;
  /** The card's height when known. */
  height: number | undefined;
  mode: ColumnMode;
  /** For an opened entry, when it was opened: a higher number is more recent. */
  openedRank?: number;
}

type ColumnLayout<K> = Map<K, { top: number; shown: "card" | "dot" }>;

/** One pass down the column with exactly the cards in `open` opened. */
function flowOnce<K>(entries: readonly ColumnEntry<K>[], open: ReadonlySet<K>): ColumnLayout<K> {
  const placed: ColumnLayout<K> = new Map();
  let floor = -Infinity;
  entries.forEach((entry, index) => {
    const top = Math.max(entry.anchor, floor);
    const height = entry.height ?? UNMEASURED_CARD_HEIGHT;
    const next = entries[index + 1];
    const pushesNext = next ? top + height + MARGIN_CARD_STACK_GAP - next.anchor : 0;
    const fits = top - entry.anchor <= DEFAULT_OPEN_MAX_DRIFT && pushesNext <= DEFAULT_OPEN_MAX_DRIFT;
    const card = open.has(entry.key) || (entry.mode === "auto" && fits);
    placed.set(entry.key, { top, shown: card ? "card" : "dot" });
    floor = card ? top + height + MARGIN_CARD_STACK_GAP : top + MARKER_SIZE + MARKER_GAP;
  });
  return placed;
}

/** Lays the margin out as one column, filled from the top. Each entry sits
 *  level with its words, or right below the entry above it when that one is
 *  in the way, so nothing ever overlaps or hides a dot. Opening an entry turns
 *  its dot into a card in the same place: the entries above it stay where
 *  they are and the ones below move down.
 *
 *  The card the reader opened last always shows. Each earlier opened card
 *  stays open only while it and every more recent open card still sit within
 *  200 px of their words; otherwise it shows as a dot until the cards in its
 *  way close. A card the reader has not touched opens by itself only when
 *  neither it nor the entry after it then sits more than 200 px below its
 *  words. Entries are given in reading order. */
export function flowMarginColumn<K>(entries: readonly ColumnEntry<K>[]): ColumnLayout<K> {
  const newestFirst = entries.filter((entry) => entry.mode === "opened").sort((a, b) => (b.openedRank ?? 0) - (a.openedRank ?? 0));
  const kept = new Set<K>();
  newestFirst.forEach((candidate, index) => {
    const trial = new Set([...kept, candidate.key]);
    const layout = flowOnce(entries, trial);
    const nearItsWords = (entry: ColumnEntry<K>) => layout.get(entry.key)!.top - entry.anchor <= DEFAULT_OPEN_MAX_DRIFT;
    if (index === 0 || newestFirst.filter((entry) => trial.has(entry.key)).every(nearItsWords)) kept.add(candidate.key);
  });
  return flowOnce(entries, kept);
}
