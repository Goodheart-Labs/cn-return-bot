import { findQuoteRange, indexContainer } from "../../../../everything-extension/utils/anchor";
import type { LabClaim } from "../../labRun";

/** Where a claim sits in the rendered article: a passage of text, or an image
 *  for a claim that rests only on an image. */
export type Anchor = { kind: "text"; range: Range } | { kind: "image"; image: HTMLImageElement };

/** The tint a claim gets, which is also its category in the legend. */
export type Tint = "lab-note" | "lab-no-note" | "lab-skipped" | "lab-error";
export const SELECTED_TINT = "lab-selected";

export function tintOf(claim: LabClaim): Tint {
  if (claim.notes.length > 0) return "lab-note";
  switch (claim.outcome.type) {
    case "no_note":
      return "lab-no-note";
    case "error":
      return "lab-error";
    default:
      return "lab-skipped";
  }
}

/** Finds each claim in the article with the extension's own matching code, so
 *  a claim the lab cannot place is one the extension could not place either.
 *  The highlighted quote is tried first, then the wider passage, then the
 *  images the claim rests on. */
export function anchorClaims(container: HTMLElement, claims: LabClaim[]): Map<string, Anchor> {
  const index = indexContainer(container);
  const images = Array.from(container.querySelectorAll("img"));
  const anchors = new Map<string, Anchor>();
  for (const claim of claims) {
    const quotes = [claim.contextQuote, claim.contextParagraph].filter((q): q is string => !!q);
    const range = quotes.map((q) => findQuoteRange(index, q)).find((r) => r !== null);
    if (range) {
      anchors.set(claim.id, { kind: "text", range });
      continue;
    }
    const image = images.find((img) => claim.imageUrls.includes(img.getAttribute("src") ?? ""));
    if (image) anchors.set(claim.id, { kind: "image", image });
  }
  return anchors;
}

/** The distance from the top of `origin` to the top of the anchor, in pixels. */
export function anchorTop(anchor: Anchor, origin: HTMLElement): number {
  const rect = anchor.kind === "text" ? anchor.range.getBoundingClientRect() : anchor.image.getBoundingClientRect();
  return rect.top - origin.getBoundingClientRect().top;
}

/** The text position under the mouse. Chrome only has the older
 *  caretRangeFromPoint, Firefox only the standard caretPositionFromPoint. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position && { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
}

/** The claims whose anchor contains the clicked point. Passages can overlap,
 *  so a click can hit several claims. */
export function claimsAtClick(event: MouseEvent, anchors: Map<string, Anchor>, visible: Set<string>): string[] {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLImageElement) {
    return [...anchors].filter(([id, a]) => visible.has(id) && a.kind === "image" && a.image === target).map(([id]) => id);
  }
  const caret = caretAt(event.clientX, event.clientY);
  if (!caret) return [];
  return [...anchors]
    .filter(([id, a]) => visible.has(id) && a.kind === "text" && a.range.isPointInRange(caret.node, caret.offset))
    .map(([id]) => id);
}
