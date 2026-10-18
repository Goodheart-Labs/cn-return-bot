/* Where margin notes go, shared by the extension and the minisite reader, so
 * both lay out their margin the same way. */

/** The box of a margin marker, in pixels. The dot is drawn smaller inside it. */
export const MARKER_SIZE = 20;
// Two markers whose words start on the same line would overlap, so the later
// one sits one marker height plus this much breathing room further down.
const MARKER_GAP = 6;
// Whatever moves down below an open card starts this far below its bottom.
const MARGIN_CARD_STACK_GAP = 12;
// A card that opens by itself does so only when it lands at most this far
// below its passage. Further down it would sit beside unrelated text, so its
// claim keeps just its dot until the reader opens it.
const DEFAULT_OPEN_MAX_DRIFT = 200;
// The height assumed for a card that has not been measured yet. It keeps the
// first layout close to the final one, so cards do not appear and then vanish.
export const UNMEASURED_CARD_HEIGHT = 320;

/** How an entry of the margin column shows: `opened` by the reader, `closed`
 *  as a dot until the reader opens it, or `auto` when it opens by itself
 *  wherever there is room. */
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

/** Where an open card sits across from the dot column. `over` covers the dot
 *  column, including any dots beside the card. `beside` starts right of the
 *  dots, so every dot stays visible. `overUnlessHidesDot` covers the dot
 *  column unless that would hide another entry's dot, and then sits beside. */
export type CardPlacement = "over" | "beside" | "overUnlessHidesDot";

export interface MarginOptions {
  /** Whether the dots below an open card move down below it. When false,
   *  every dot stays at its home and only cards push cards down. */
  dotsMakeRoom: boolean;
  cardPlacement: CardPlacement;
}

// Jim's call on 2026-10-16: dots stay beside their words, and a card covers
// the dot column unless that would hide another dot.
export const DEFAULT_MARGIN_OPTIONS: MarginOptions = { dotsMakeRoom: false, cardPlacement: "overUnlessHidesDot" };

// The space between the dot column and a card that sits beside it.
const CARD_BESIDE_GAP = 8;
/** How far right of the dot column's left edge a card that sits beside the
 *  dots starts. */
export const CARD_BESIDE_OFFSET = MARKER_SIZE + CARD_BESIDE_GAP;

export type CardSide = "over" | "beside";

/** Where one entry goes. `displaced` marks a card that showed, or was opened,
 *  but now shows as a dot to make room for a card the reader opened later. */
export interface PlacedEntry {
  dotTop: number;
  /** False when the entry's own card covers its dot. */
  dotShown: boolean;
  /** The entry's card, or null when it shows only its dot. */
  card: { top: number; side: CardSide } | null;
  displaced: boolean;
}

/** One pass down the column: each entry's top, which is its card's top when
 *  `card` is true. */
type Flow<K> = Map<K, { top: number; card: boolean; displaced: boolean }>;

/** Positions closer than this count as the same place. */
const SAME_PLACE_PX = 0.5;

const heightOf = <K>(entry: ColumnEntry<K>) => entry.height ?? UNMEASURED_CARD_HEIGHT;

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
 *  the reader has not touched stays a dot when it is in `yielded`. A dot
 *  pushes the entries below it down only when dots make room. */
function flowOnce<K>(entries: readonly ColumnEntry<K>[], homes: ReadonlyMap<K, number>, open: ReadonlySet<K>, yielded: ReadonlySet<K>, dotsMakeRoom: boolean): Flow<K> {
  const placed: Flow<K> = new Map();
  let floor = -Infinity;
  for (const entry of entries) {
    const home = homes.get(entry.key)!;
    const top = Math.max(home, floor);
    const card = open.has(entry.key) || (entry.mode === "auto" && !yielded.has(entry.key) && top - home <= DEFAULT_OPEN_MAX_DRIFT);
    const displaced = !card && (entry.mode === "opened" || yielded.has(entry.key));
    placed.set(entry.key, { top, card, displaced });
    if (card) floor = top + heightOf(entry) + MARGIN_CARD_STACK_GAP;
    else if (dotsMakeRoom) floor = top + MARKER_SIZE + MARKER_GAP;
  }
  return placed;
}

/** Cards the reader has not touched give way to the cards the reader opened:
 *  while an opened card is pushed off its home, the nearest untouched card
 *  above it turns into a dot. */
function yieldUntouchedCards<K>(entries: readonly ColumnEntry<K>[], homes: ReadonlyMap<K, number>, open: ReadonlySet<K>, dotsMakeRoom: boolean): Flow<K> {
  const yielded = new Set<K>();
  for (;;) {
    const flow = flowOnce(entries, homes, open, yielded, dotsMakeRoom);
    const pushed = entries.findIndex((entry) => open.has(entry.key) && flow.get(entry.key)!.top > homes.get(entry.key)! + SAME_PLACE_PX);
    if (pushed < 0) return flow;
    const inTheWay = entries.slice(0, pushed).findLast((entry) => entry.mode === "auto" && flow.get(entry.key)!.card);
    if (!inTheWay) return flow;
    yielded.add(inTheWay.key);
  }
}

/** Which side of the dot column a card takes. */
function cardSide<K>(key: K, top: number, height: number, dotTops: ReadonlyMap<K, number>, placement: CardPlacement): CardSide {
  if (placement !== "overUnlessHidesDot") return placement;
  const hidesDot = [...dotTops].some(([other, dotTop]) => other !== key && dotTop + MARKER_SIZE > top && dotTop < top + height);
  return hidesDot ? "beside" : "over";
}

/** Lays the margin out as one column, filled from the top. Every entry has a
 *  home: the place its dot takes when every entry is a dot, level with its
 *  words or stacked below the dot above it.
 *
 *  The card the reader opened last sits exactly at its home. Any card above
 *  it that reaches into that place turns into a dot, whether the reader
 *  opened it or it opened by itself. Each earlier opened card stays open only
 *  while it, and every more recent open card, still sit at their homes.
 *  Every card below an open card moves down below it, and so does every dot
 *  when dots make room. Otherwise dots stay at their homes, and
 *  `cardPlacement` decides whether a card covers them. A card the reader has
 *  not touched opens by itself when it lands at most 200 px below its home,
 *  so in a crowded paragraph the first entry opens. Entries are given in
 *  reading order. */
export function flowMarginColumn<K>(entries: readonly ColumnEntry<K>[], { dotsMakeRoom, cardPlacement }: MarginOptions = DEFAULT_MARGIN_OPTIONS): Map<K, PlacedEntry> {
  const homes = homeTops(entries);
  const newestFirst = entries.filter((entry) => entry.mode === "opened").sort((a, b) => (b.openedRank ?? 0) - (a.openedRank ?? 0));
  const kept = new Set<K>();
  newestFirst.forEach((candidate, index) => {
    const trial = new Set([...kept, candidate.key]);
    const flow = yieldUntouchedCards(entries, homes, trial, dotsMakeRoom);
    const atHome = (entry: ColumnEntry<K>) => flow.get(entry.key)!.top <= homes.get(entry.key)! + SAME_PLACE_PX;
    if (index === 0 || newestFirst.filter((entry) => trial.has(entry.key)).every(atHome)) kept.add(candidate.key);
  });
  const flow = yieldUntouchedCards(entries, homes, kept, dotsMakeRoom);
  const dotTops = new Map(entries.map((entry) => [entry.key, dotsMakeRoom ? flow.get(entry.key)!.top : homes.get(entry.key)!]));
  return new Map(entries.map((entry): [K, PlacedEntry] => {
    const { top, card, displaced } = flow.get(entry.key)!;
    const dotTop = dotTops.get(entry.key)!;
    if (!card) return [entry.key, { dotTop, dotShown: true, card: null, displaced }];
    const side = cardSide(entry.key, top, heightOf(entry), dotTops, cardPlacement);
    // A card pushed below its home leaves its dot uncovered above it.
    return [entry.key, { dotTop, dotShown: side === "beside" || top > dotTop + SAME_PLACE_PX, card: { top, side }, displaced }];
  }));
}
