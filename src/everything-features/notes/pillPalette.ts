import { createContext } from "react";

/** How the rating pills are coloured. `colourful`, the default (Jim,
 *  2026-09-29), gives Yes, Somewhat and No the rating colours green, amber
 *  and red as text, filled once chosen, so the rating stands out from the
 *  note's blue action links. `neutral` draws all three alike, outlined with
 *  blue text, as X's Community Notes do. Readers of the extension pick one on
 *  its settings page; the website shows the default. */
export type PillPalette = "neutral" | "colourful";

export const DEFAULT_PILL_PALETTE: PillPalette = "colourful";

export const PillPaletteContext = createContext<PillPalette>(DEFAULT_PILL_PALETTE);
