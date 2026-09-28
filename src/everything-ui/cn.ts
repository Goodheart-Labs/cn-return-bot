import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { CN_COLORS } from "./tailwind.preset";

/* tailwind-merge resolves conflicts between Tailwind classes: in
 * cn("px-3 text-fg", "px-4") the later px-4 wins and px-3 is dropped. It has to
 * know our own theme names, or it would mistake a colour such as `text-fg` for
 * a text size and drop the wrong class. */
const mergeClasses = extendTailwindMerge({
  extend: {
    theme: { colors: Object.keys(CN_COLORS), borderRadius: ["control", "card"] },
    classGroups: {
      "font-size": [{ text: ["2xs", "display"] }],
      shadow: [{ shadow: ["raised", "floating"] }],
    },
  },
});

/** Joins class names, dropping falsy ones, and lets a later class override an
 *  earlier one of the same kind. Components use it so a caller's className can
 *  adjust their defaults. */
export const cn = (...inputs: ClassValue[]) => mergeClasses(clsx(inputs));
