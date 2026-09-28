import type { SVGProps } from "react";

/* The icons the product uses. The generic ones come from Lucide, an open
 * icon set drawn on a 24-pixel grid with round strokes. They are listed here
 * under names that say what they mean in Common Notes, so a component asks
 * for "the share icon" and the set can be swapped in one place. Every icon
 * takes a `size` in pixels and inherits the text colour. */
export {
  ArrowDown as ArrowDownIcon,
  ArrowUp as ArrowUpIcon,
  Check as CheckIcon,
  ChevronRight as ChevronIcon,
  Ellipsis as MoreIcon,
  MessageSquare as SpeechBubbleIcon,
  Pencil as PencilIcon,
  Quote as QuoteIcon,
  Share as ShareIcon,
  Trash2 as TrashIcon,
  X as CloseIcon,
} from "lucide-react";

/** The group-of-people glyph from Material Symbols, named "groups". It is our
 *  community marker and is drawn in a 24 by 24 viewBox. Both marker surfaces use
 *  this one path: the Substack badge and the pin on YouTube's scrub bar. */
export const GROUP_GLYPH_PATH = "M0 18v-1.575q0-1.1 1.1-1.763T4 14q.325 0 .625.013t.575.062q-.35.525-.525 1.1T4.5 16.4V18Zm6 0v-1.6q0-.8.438-1.463t1.237-1.162Q8.475 13.275 9.55 13T12 12.725q1.375 0 2.45.275t1.875.775q.8.5 1.238 1.163T18 16.4V18Zm13.5 0v-1.6q0-.65-.163-1.225t-.487-1.075q.275-.05.563-.075T20 14q1.8 0 2.9.663t1.1 1.762V18ZM4 13q-.825 0-1.412-.588T2 11q0-.85.588-1.425T4 9q.85 0 1.425.575T6 11q0 .825-.575 1.413T4 13Zm16 0q-.825 0-1.413-.588T18 11q0-.85.588-1.425T20 9q.85 0 1.425.575T22 11q0 .825-.575 1.413T20 13Zm-8-1q-1.25 0-2.125-.875T9 9q0-1.275.875-2.138T12 6q1.275 0 2.138.863T15 9q0 1.25-.862 2.125T12 12Z";

export function GroupIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d={GROUP_GLYPH_PATH} />
    </svg>
  );
}


/** A single wave, the mark of a "somewhat helpful" rating. Lucide has no plain
 *  tilde, so it is drawn here in Lucide's style. */
export function WaveIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2.5 9c1.8-2.6 3.7-2.6 5.5 0s3.7 2.6 5.5 0" />
    </svg>
  );
}
