/** The one palette for the markers we draw inside host pages, where Tailwind
 *  cannot reach: the scrubber pins, the coverage badges, and the inline note
 *  badge (whose Tailwind classes must resolve to these same values). The three
 *  surfaces drifted apart when each carried its own copy. */
export interface MarkerColors {
  body: string;
  border: string;
  glyph: string;
}

/* body = white / gray-900, border = gray-300 / gray-600, glyph = blue-600 / blue-400 */
export const MARKER_LIGHT: MarkerColors = { body: "#ffffff", border: "#d1d5db", glyph: "#2563eb" };
export const MARKER_DARK: MarkerColors = { body: "#111827", border: "#4b5563", glyph: "#60a5fa" };

export const MARKER_HOVER_SCALE = 1.1;
export const MARKER_GLYPH_SIZE = 14;
export const MARKER_SHADOW = "0 1px 3px rgba(0,0,0,0.25)";

/** The passage tint drawn behind noted text via the CSS Custom Highlight API.
 *  Light is blue-500 at low opacity; dark is blue-400 and stronger, so it
 *  still reads on a dark page. */
export const PASSAGE_TINT_LIGHT = "rgba(59, 130, 246, 0.16)";
export const PASSAGE_TINT_DARK = "rgba(96, 165, 250, 0.25)";
