import type { ExtractedClaim, ItemSource } from "../types";

// We fact-check the author's own words. The point is the verbatim text the
// author wrote, and nothing else comes with it: no restatement and no
// surrounding paragraph. A restatement can drift away from the source, and the
// search model can read what the author actually wrote.
// A point that is an image has no text of its own. Its claim is the description
// of the image and the text visible in it, which goes in under "Image". The
// image itself reaches the model through the pipeline's media analysis.
// The fact-check reads these fields as labelled lines of a synthetic post. The
// rating step reads them as a JSON object. Both steps judge the same words.
export function claimCheckFields(claim: ExtractedClaim, source: ItemSource): Record<string, string> {
  const origin = source === "youtube" ? "Transcript" : "Article";
  const point = claim.context.trim();
  const fields: Record<string, string> = {};
  if (point) fields[`Passage from ${origin}`] = point;
  else fields["Image"] = claim.claim;
  if (claim.steer) fields["A reader asked for a note about"] = claim.steer.replace(/\s+/g, " ").trim();
  return fields;
}
