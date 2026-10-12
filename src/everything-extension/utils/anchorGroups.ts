import type { AnchoredGroup } from "../components/InlineNotes";
import { findQuoteRange, indexContainer } from "./anchor";
import type { ClaimGroup } from "./claimGroups";

/** The stable part of a claim image URL: the original file name. The pipeline
 *  stores Substack CDN fetch URLs, which wrap the original image URL with size
 *  and quality parameters that differ between page renderings; the uploaded
 *  file's name is the piece both sides share. */
function claimImageFilename(cdnUrl: string): string | null {
  let decoded = cdnUrl;
  try {
    decoded = decodeURIComponent(cdnUrl);
  } catch {
    // A malformed escape leaves the raw URL, which still ends in the name.
  }
  return decoded.split("/").pop()?.split("?")[0] || null;
}

/** A range around the image a claim is grounded in, or null when the page does
 *  not show that image. This is how an image-only claim, whose quote columns
 *  are all null, still gets a marker: it hangs off the picture instead of a
 *  passage. */
function findClaimImageRange(container: Element, imageUrls: string[]): Range | null {
  for (const url of imageUrls) {
    const name = claimImageFilename(url);
    if (!name) continue;
    for (const img of container.querySelectorAll("img")) {
      let src = img.currentSrc || img.src || "";
      try {
        src = decodeURIComponent(src);
      } catch {
        // Compared raw instead.
      }
      if (src.includes(name)) {
        const range = document.createRange();
        range.selectNode(img);
        return range;
      }
    }
  }
  return null;
}

/** Anchors every claim group to a range inside the container. Each claim
 *  offers three quotes and we try them in order of reliability. First the updated
 *  quote, which is how the passage reads on the page today. Then the quote that was
 *  captured when the claim was extracted. Then the wider paragraph around it.
 *  A claim that has no anchorable text but carries images, such as a note on a
 *  chart, anchors to its image. */
export function anchorGroups(container: Element, groups: ClaimGroup[]): AnchoredGroup[] {
  const index = indexContainer(container);
  const anchored: AnchoredGroup[] = [];
  for (const group of groups) {
    const { claim } = group;
    const candidates = [claim.updated_quote, claim.context_quote, claim.context_paragraph];
    let range: Range | null = null;
    for (const candidate of candidates) {
      if (candidate) range = findQuoteRange(index, candidate);
      if (range) break;
    }
    if (!range && claim.image_urls.length > 0) range = findClaimImageRange(container, claim.image_urls);
    if (range) anchored.push({ ...group, range });
  }
  console.info(`[common-notes] anchored ${anchored.length}/${groups.length} claims on this page`);
  return anchored;
}
