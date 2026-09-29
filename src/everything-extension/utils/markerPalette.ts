import type { NoteStatus } from "@cn/core/noteScore";

/** The one palette for the markers we draw into host pages themselves: the
 *  scrubber pins, the coverage badges and the passage tint. They live in the
 *  page's own DOM, outside our shadow roots, where the design tokens do not
 *  reach, so they carry literal colours. The values copy tokens.css: the
 *  body is `surface`, the border `line-strong` and the glyph `link`, which is
 *  also what the inline note badge draws with. */
export interface MarkerColors {
  body: string;
  border: string;
  glyph: string;
}

export const MARKER_LIGHT: MarkerColors = { body: "#ffffff", border: "#d1d5db", glyph: "#2563eb" };
export const MARKER_DARK: MarkerColors = { body: "#111827", border: "#4b5563", glyph: "#60a5fa" };

/** A scrubber pin's glyph takes the colour of its claim's status. These copy
 *  the `positive-solid`, `pending-solid` and `negative-solid` tokens, which
 *  the note card's status dot and the article markers draw with. */
export const STATUS_MARKER_GLYPH: Record<NoteStatus, string> = {
  helpful: "#22c55e",
  needs_ratings: "#3b82f6",
  not_helpful: "#ef4444",
};

export const MARKER_HOVER_SCALE = 1.1;
export const MARKER_GLYPH_SIZE = 14;
export const MARKER_SHADOW = "0 1px 3px rgba(0,0,0,0.25)";

/** The passage tint drawn behind noted text via the CSS Custom Highlight API.
 *  Light is blue-500 at low opacity; dark is blue-400 and stronger, so it
 *  still reads on a dark page. */
export const PASSAGE_TINT_LIGHT = "rgba(59, 130, 246, 0.16)";
export const PASSAGE_TINT_DARK = "rgba(96, 165, 250, 0.25)";
