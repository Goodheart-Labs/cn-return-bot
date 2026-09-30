import type { SVGProps } from "react";

/* The icons the product uses. The generic ones come from Remix Icon, an open
 * icon set drawn on a 24-pixel grid, in its filled style, which suits the
 * product's friendly corners and colours better than a thin outline set. The
 * chevrons are the exception: Remix draws their filled versions as solid
 * triangles, so they come from its line style. The close icon is Remix's
 * large cross, because its regular cross looks small beside the check. The icons are listed
 * here under names that say what they mean in Common Notes, so a component
 * asks for "the share icon" and the set can be swapped in one place. Every
 * icon takes a `size` in pixels and inherits the text colour. */
export {
  RiArrowDownFill as ArrowDownIcon,
  RiArrowUpFill as ArrowUpIcon,
  RiCheckFill as CheckIcon,
  RiArrowLeftSLine as PreviousIcon,
  RiArrowRightSLine as ChevronIcon,
  RiArrowRightSLine as NextIcon,
  RiMoreFill as MoreIcon,
  RiExternalLinkFill as ExternalLinkIcon,
  RiGlobalFill as GlobeIcon,
  RiChat3Fill as SpeechBubbleIcon,
  RiPencilFill as PencilIcon,
  RiDoubleQuotesL as QuoteIcon,
  RiUpload2Fill as ShareIcon,
  RiDeleteBinFill as TrashIcon,
  RiCloseLargeFill as CloseIcon,
} from "@remixicon/react";

/** Two notes lying on top of each other, the front one with two lines of
 *  text. It is our note marker and is drawn in a 24 by 24 viewBox. Every
 *  marker surface uses this one path: the passage marker, the note-count badge
 *  on listings, and the pin on YouTube's scrub bar. The text lines are holes in
 *  the front note, so the path must be filled with the evenodd rule. The gap
 *  between the two notes is 3 units wide. A narrower gap falls below one pixel
 *  at the 11px pin size and closes up on dark pages. */
export const NOTE_STACK_GLYPH_PATH = "M7.5 5.2A2.2 2.2 0 0 1 9.7 3H18.8A2.2 2.2 0 0 1 21 5.2V14.3A2.2 2.2 0 0 1 18.8 16.5V5.2ZM5.6 8.2H13.2A2.6 2.6 0 0 1 15.8 10.8V18.4A2.6 2.6 0 0 1 13.2 21H5.6A2.6 2.6 0 0 1 3 18.4V10.8A2.6 2.6 0 0 1 5.6 8.2ZM7 11.3H11.6a1.4 1.4 0 0 1 0 2.8H7a1.4 1.4 0 0 1 0 -2.8ZM7 15.5H8.9a1.4 1.4 0 0 1 0 2.8H7a1.4 1.4 0 0 1 0 -2.8Z";

export function NoteStackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d={NOTE_STACK_GLYPH_PATH} fillRule="evenodd" />
    </svg>
  );
}


/** A single wave, the mark of a "somewhat helpful" rating. It sits between the
 *  check and the cross. Remix Icon has no plain tilde, so it is drawn here on
 *  Remix's 24-unit grid, centred and as wide as its check. Its line is a bit
 *  thicker than the check's 2 units, because a thin curve looks lighter than
 *  straight strokes of the same width at the chips' 12px. */
export function WaveIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 12c2.7-3.6 5.3-3.6 8 0s5.3 3.6 8 0" />
    </svg>
  );
}
