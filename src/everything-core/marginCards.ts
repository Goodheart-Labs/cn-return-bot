/* Where margin notes go, shared by the extension and the minisite reader, so
 * both lay out their margin the same way. */

/** The box of a margin marker, in pixels. The dot is drawn smaller inside it. */
export const MARKER_SIZE = 20;
// Two markers whose words start on the same line would overlap, so the later
// one sits one marker height plus this much breathing room further down.
const MARKER_GAP = 6;
// An entry below an open card starts this far below the card's bottom.
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
