/** The design system's shared class strings. Every surface in the website and
 *  the extension builds from these; a button or card styled some other way is
 *  a bug. Components that need markup as well as classes (IconButton, Modal)
 *  live in everything-web/src/components, which the extension already imports
 *  from. */

export const BUTTON =
  "bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40";

export const SECONDARY_BUTTON =
  "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40";

export const LINK = "text-blue-600 dark:text-blue-400 hover:underline";

export const QUIET_LINK = "text-gray-500 dark:text-gray-400 hover:underline";

export const INPUT =
  "border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg px-3 py-1.5 text-sm";

/** In-flow card: sits in the page, border, no shadow. */
export const CARD = "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700";

/** Floating card: popovers, overlay cards, modals, dropdowns. */
export const FLOATING_CARD = `${CARD} shadow-xl`;

/** Dropdown menu container; menu items come from NoteMenu's MenuItem. */
export const MENU = `${FLOATING_CARD} w-56 p-1.5 text-sm`;

/** The one pill family: jump chips, vote pills, filter chips. */
export const CHIP = "inline-flex items-center gap-1 h-6 px-2 rounded-full border text-xs font-semibold";

/** Quoted material: source quotes, context excerpts, claim blockquotes. */
export const QUOTE_RAIL = "border-l-4 border-gray-300 dark:border-gray-600 pl-3";

/** The uppercase label style for small section markers. */
export const EYEBROW = "text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500";
