import { createContext } from "react";

/** How the rating pills are coloured before anyone votes. `neutral` draws all
 *  three the same, outlined with blue text, as X's Community Notes do.
 *  `colourful` gives each its rating colour: green, amber and red. Jim is
 *  choosing between the two in Storybook (2026-09-28); once he has, the
 *  losing palette and this context go away. */
export type PillPalette = "neutral" | "colourful";

export const PillPaletteContext = createContext<PillPalette>("neutral");
