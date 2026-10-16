import { PASSAGE_FOCUS_TINT_DARK, PASSAGE_FOCUS_TINT_LIGHT, PASSAGE_TINT_DARK, PASSAGE_TINT_LIGHT } from "./markerPalette";
import { assignLayers } from "./overlaps";

// The highlight registry is global to the page, and any extension could pick
// a generic name. Ours is namespaced so we never overwrite another
// extension's tint, and our unmount delete never removes theirs.
const HIGHLIGHT_NAME = "common-notes-passage-tint";

/** Overlapping quotes are tinted in separate layers, so the text they share
 *  looks darker. Beyond this many layers the text would get hard to read, so
 *  further overlaps stop getting darker. */
const HIGHLIGHT_LAYERS = 3;
const LAYER_NAMES = Array.from({ length: HIGHLIGHT_LAYERS }, (_, index) => `${HIGHLIGHT_NAME}-${index + 1}`);

/** The stronger tint on the exact words of the claim the reader points at or
 *  opened. Its priority puts it above the layers. */
const FOCUS_HIGHLIGHT_NAME = `${HIGHLIGHT_NAME}-focus`;
const FOCUS_HIGHLIGHT_PRIORITY = 1;

/** Whether this browser has the CSS Custom Highlight API. TypeScript's DOM
 *  types assume it always does, but old Firefox ESR releases lack it. */
export const hasHighlightApi = () => "highlights" in CSS;

/** Makes sure the ::highlight rules exist in the host document. The rules cannot live
 *  in our shadow root, because the text they highlight belongs to the page itself.
 *  Calling this again is safe. It reuses the one style element carrying our id, and
 *  it rewrites the tints in place when the page flips between light and dark. */
export function ensureHighlightStyle(dark: boolean) {
  let style = document.getElementById("common-notes-highlight-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "common-notes-highlight-style";
    document.head.appendChild(style);
  }
  const tint = dark ? PASSAGE_TINT_DARK : PASSAGE_TINT_LIGHT;
  const focusTint = dark ? PASSAGE_FOCUS_TINT_DARK : PASSAGE_FOCUS_TINT_LIGHT;
  const text = [
    ...LAYER_NAMES.map((name) => `::highlight(${name}) { background-color: ${tint}; }`),
    `::highlight(${FOCUS_HIGHLIGHT_NAME}) { background-color: ${focusTint}; }`,
  ].join("\n");
  if (style.textContent !== text) style.textContent = text;
}

// A DOM Range compares its boundaries with compareBoundaryPoints. END_TO_START
// compares this range's start with the other range's end.
const rangeOrder = {
  compareStarts: (a: Range, b: Range) => a.compareBoundaryPoints(Range.START_TO_START, b),
  overlaps: (a: Range, b: Range) => a.compareBoundaryPoints(Range.END_TO_START, b) < 0 && b.compareBoundaryPoints(Range.END_TO_START, a) < 0,
};

function setHighlight(name: string, ranges: Range[], priority = 0) {
  if (ranges.length === 0) return CSS.highlights.delete(name);
  const highlight = new Highlight(...ranges);
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
}

/** Tints the anchored passages with the CSS Custom Highlight API. That API changes no
 *  nodes in the host page, so the page's own framework never notices us. */
export function applyHighlights(ranges: Range[]) {
  if (!hasHighlightApi()) return; // Old Firefox ESR has no Highlight API. Badges still show, only the tint is missing.
  assignLayers(ranges, rangeOrder, HIGHLIGHT_LAYERS).forEach((layer, index) => setHighlight(LAYER_NAMES[index]!, layer));
}

/** Draws the stronger tint over one claim's exact words, or removes it. */
export function applyFocusHighlight(range: Range | null) {
  if (!hasHighlightApi()) return;
  setHighlight(FOCUS_HIGHLIGHT_NAME, range ? [range] : [], FOCUS_HIGHLIGHT_PRIORITY);
}

/** Removes every tint of ours from the page. */
export function clearHighlights() {
  if (!hasHighlightApi()) return;
  for (const name of [...LAYER_NAMES, FOCUS_HIGHLIGHT_NAME]) CSS.highlights.delete(name);
}
