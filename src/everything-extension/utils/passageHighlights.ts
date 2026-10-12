import { PASSAGE_TINT_DARK, PASSAGE_TINT_LIGHT } from "./markerPalette";

// The highlight registry is global to the page, and any extension could pick
// a generic name. Ours is namespaced so we never overwrite another
// extension's tint, and our unmount delete never removes theirs.
export const HIGHLIGHT_NAME = "common-notes-passage-tint";

/** Whether this browser has the CSS Custom Highlight API. TypeScript's DOM
 *  types assume it always does, but old Firefox ESR releases lack it. */
export const hasHighlightApi = () => "highlights" in CSS;

/** Makes sure the ::highlight rule exists in the host document. The rule cannot live
 *  in our shadow root, because the text it highlights belongs to the page itself.
 *  Calling this again is safe. It reuses the one style element carrying our id, and
 *  it rewrites the tint in place when the page flips between light and dark. */
export function ensureHighlightStyle(dark: boolean) {
  let style = document.getElementById("common-notes-highlight-style") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "common-notes-highlight-style";
    document.head.appendChild(style);
  }
  const text = `::highlight(${HIGHLIGHT_NAME}) { background-color: ${dark ? PASSAGE_TINT_DARK : PASSAGE_TINT_LIGHT}; }`;
  if (style.textContent !== text) style.textContent = text;
}

/** Tints the anchored passages with the CSS Custom Highlight API. That API changes no
 *  nodes in the host page, so the page's own framework never notices us. */
export function applyHighlights(ranges: Range[]) {
  if (!hasHighlightApi()) return; // Old Firefox ESR has no Highlight API. Badges still show, only the tint is missing.
  if (ranges.length === 0) CSS.highlights.delete(HIGHLIGHT_NAME);
  else CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}
