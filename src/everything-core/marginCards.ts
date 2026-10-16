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

/** Where each entry goes. `displaced` marks a card that showed, or was opened,
 *  but now shows as a dot to make room for a card the reader opened later. */
type ColumnLayout<K> = Map<K, { top: number; shown: "card" | "dot"; displaced: boolean }>;

/** Positions closer than this count as the same place. */
const SAME_PLACE_PX = 0.5;

/** Each entry's home: where its dot sits when every entry is a dot. */
function homeTops<K>(entries: readonly ColumnEntry<K>[]): Map<K, number> {
  const homes = new Map<K, number>();
  let floor = -Infinity;
  for (const entry of entries) {
    const top = Math.max(entry.anchor, floor);
    homes.set(entry.key, top);
    floor = top + MARKER_SIZE + MARKER_GAP;
  }
  return homes;
}

/** One pass down the column with exactly the cards in `open` opened. A card
 *  the reader has not touched stays a dot when it is in `yielded`. */
function flowOnce<K>(entries: readonly ColumnEntry<K>[], homes: ReadonlyMap<K, number>, open: ReadonlySet<K>, yielded: ReadonlySet<K>): ColumnLayout<K> {
  const placed: ColumnLayout<K> = new Map();
  let floor = -Infinity;
  for (const entry of entries) {
    const home = homes.get(entry.key)!;
    const top = Math.max(home, floor);
    const height = entry.height ?? UNMEASURED_CARD_HEIGHT;
    const card = open.has(entry.key) || (entry.mode === "auto" && !yielded.has(entry.key) && top - home <= DEFAULT_OPEN_MAX_DRIFT);
    const displaced = !card && (entry.mode === "opened" || yielded.has(entry.key));
    placed.set(entry.key, { top, shown: card ? "card" : "dot", displaced });
    floor = card ? top + height + MARGIN_CARD_STACK_GAP : top + MARKER_SIZE + MARKER_GAP;
  }
  return placed;
}

/** Cards the reader has not touched give way to the cards the reader opened:
 *  while an opened card is pushed off its home, the nearest untouched card
 *  above it turns into a dot. */
function yieldUntouchedCards<K>(entries: readonly ColumnEntry<K>[], homes: ReadonlyMap<K, number>, open: ReadonlySet<K>): ColumnLayout<K> {
  const yielded = new Set<K>();
  for (;;) {
    const layout = flowOnce(entries, homes, open, yielded);
    const pushed = entries.findIndex((entry) => open.has(entry.key) && layout.get(entry.key)!.top > homes.get(entry.key)! + SAME_PLACE_PX);
    if (pushed < 0) return layout;
    const inTheWay = entries.slice(0, pushed).findLast((entry) => entry.mode === "auto" && layout.get(entry.key)!.shown === "card");
    if (!inTheWay) return layout;
    yielded.add(inTheWay.key);
  }
}

/** Lays the margin out as one column, filled from the top, so nothing ever
 *  overlaps or hides a dot. Every entry has a home: the place its dot takes
 *  when every entry is a dot, level with its words or stacked below the dot
 *  above it.
 *
 *  The card the reader opened last sits exactly at its home. Any card above
 *  it that reaches into that place turns into a dot, whether the reader
 *  opened it or it opened by itself. Each earlier opened card stays open only
 *  while it, and every more recent open card, still sit at their homes.
 *  Everything below an open card moves down below it. A card the reader has
 *  not touched opens by itself when it lands at most 200 px below its home,
 *  so in a crowded paragraph the first entry opens and the rest show as dots
 *  below it. Entries are given in reading order. */
export function flowMarginColumn<K>(entries: readonly ColumnEntry<K>[]): ColumnLayout<K> {
  const homes = homeTops(entries);
  const newestFirst = entries.filter((entry) => entry.mode === "opened").sort((a, b) => (b.openedRank ?? 0) - (a.openedRank ?? 0));
  const kept = new Set<K>();
  newestFirst.forEach((candidate, index) => {
    const trial = new Set([...kept, candidate.key]);
    const layout = yieldUntouchedCards(entries, homes, trial);
    const atHome = (entry: ColumnEntry<K>) => layout.get(entry.key)!.top <= homes.get(entry.key)! + SAME_PLACE_PX;
    if (index === 0 || newestFirst.filter((entry) => trial.has(entry.key)).every(atHome)) kept.add(candidate.key);
  });
  return yieldUntouchedCards(entries, homes, kept);
}
