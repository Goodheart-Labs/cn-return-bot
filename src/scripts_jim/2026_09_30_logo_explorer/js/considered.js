/* Every logo we considered, as the files it shipped or would have shipped.
 * They are kept in considered/, one folder per option, so a past choice can
 * be looked at again after its pull request is gone. See considered/README.md
 * for where each folder's files come from. */

import { element } from "./dom.js";
import { CANDIDATES } from "./logos.js";

/** A file per logo slot role. A role with a light and a dark file differs
 *  between the two modes. A favicon of null means the website had none, and
 *  Chrome shows its globe. Small places get the 32 pixel file, which is what
 *  Chrome takes on a sharp screen. The store slot takes the file uploaded to
 *  the Chrome Web Store. */
const NOTE_CARD_FILES = {
  store: "extension-icon-128.png",
  header: "logo.svg",
  favicon: null,
  toolbar: "extension-icon-32.png",
  menu: "extension-icon-32.png",
};

const STACKED_NOTES_FILES = {
  store: "store-chrome-128.png",
  header: "logo.svg",
  favicon: "website-favicon-32.png",
  toolbar: "extension-icon-32.png",
  menu: "extension-icon-32.png",
};

// The explorer's candidates were never in a pull request. export-logos.ts
// draws each one at its defaults, in the forms the extension would ship it in.
const EXPLORER_FILES = {
  store: "store-icon.svg",
  header: "icon.svg",
  favicon: { light: "small-icon.svg", dark: "dark-tile.svg" },
  toolbar: { light: "small-icon.svg", dark: "dark-tile.svg" },
  menu: "menu-tile.svg",
};

export const CONSIDERED = [
  { folder: "08-two-rectangles", name: "Two rectangles, the logo we picked (GOO-330)", files: { ...STACKED_NOTES_FILES, store: "extension-icon-128.png" } },
  { folder: "01-note-card-red-first", name: "The note card, red first, before this work", files: NOTE_CARD_FILES },
  { folder: "02-note-card-green-first", name: "Note card, green first, bold in the extension", files: NOTE_CARD_FILES },
  { folder: "03-note-card-thin-everywhere", name: "Note card, the website's thin logo everywhere", files: NOTE_CARD_FILES },
  { folder: "04-note-card-thin-and-bold", name: "Note card, thin for large sizes and bold for small ones", files: NOTE_CARD_FILES },
  { folder: "05-stacked-notes-plain-blue", name: "Stacked notes, plain blue everywhere", files: STACKED_NOTES_FILES },
  { folder: "06-stacked-notes-blue-tile", name: "Stacked notes, white on a blue tile everywhere", files: STACKED_NOTES_FILES },
  {
    folder: "07-stacked-notes-light-and-dark",
    name: "Stacked notes, plain in light mode and on tiles in dark mode and the menu",
    files: {
      ...STACKED_NOTES_FILES,
      favicon: { light: "website-favicon-32.png", dark: "website-favicon-dark-32.png" },
      toolbar: { light: "extension-icon-32.png", dark: "extension-icon-tile-32.png" },
      menu: "extension-icon-menu-32.png",
    },
  },
  ...CANDIDATES.map((candidate) => ({ folder: `explorer/${candidate.id}`, name: `Explorer: ${candidate.name}, at its defaults`, files: EXPLORER_FILES })),
];

/** The image a considered logo puts into one logo slot. */
export function consideredImage(option, pixels, role, theme) {
  const file = option.files[role];
  if (file === null) return element("span", { className: "chrome-globe", title: "This logo came with no favicon for the website" });
  const name = typeof file === "string" ? file : file[theme];
  return element("img", { className: "logo-image", alt: "", width: pixels, height: pixels, src: `considered/${option.folder}/${name}` });
}
