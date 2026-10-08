import { cva } from "class-variance-authority";

/** The one pill shape: rating pills, jump chips and the item links. The
 *  caller adds the colours, because a pill's colour carries its meaning. */
export const chipVariants = cva(
  "inline-flex items-center gap-1 h-6 px-2 rounded-control border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
);
