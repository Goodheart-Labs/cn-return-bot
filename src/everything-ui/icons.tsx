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
 *  the front note, so the path must be filled with the evenodd rule.
 *  The proportions were picked in the logo explorer (GOO-299). The mark spans
 *  18 of the 24 units, and the gap between the two notes is about 1.9 units.
 *  On the 11 pixel pin that gap is just under one pixel on a normal screen. */
export const NOTE_STACK_GLYPH_PATH =
  "M7.06,5.23c0,-1.23 1,-2.23 2.23,-2.23h9.48c1.23,0 2.23,1 2.23,2.23v9.48c0,1.23 -1,2.23 -2.23,2.23h-0.58v-11.13h-11.13zM5.71,21c-1.5,0 -2.71,-1.21 -2.71,-2.71v-7.84c0,-1.5 1.21,-2.71 2.71,-2.71h7.84c1.5,0 2.71,1.21 2.71,2.71v7.84c0,1.5 -1.21,2.71 -2.71,2.71zM11.9,13.84c0.8,0 1.45,-0.65 1.45,-1.45c0,-0.8 -0.65,-1.45 -1.45,-1.45h-4.74c-0.8,0 -1.45,0.65 -1.45,1.45c0,0.8 0.65,1.45 1.45,1.45zM9.1,18.19c0.8,0 1.45,-0.65 1.45,-1.45c0,-0.8 -0.65,-1.45 -1.45,-1.45h-1.94c-0.8,0 -1.45,0.65 -1.45,1.45c0,0.8 0.65,1.45 1.45,1.45z";

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
