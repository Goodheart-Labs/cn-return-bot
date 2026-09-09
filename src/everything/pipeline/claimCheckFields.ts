import type { ExtractedClaim, ItemSource } from "../types";

// We fact-check the author's own words. The claim text carries the verbatim
// highlighted span, the passage around it, and any images the claim rests on. It
// does not carry Opus's neutral restatement of the claim. That restatement is
// useful during extraction, because it forces Opus to state the claim, but it
// can drift away from the source. So we keep it out of the fact-check input and
// let the search model read what the author actually wrote. The surrounding
// passage contains the highlighted span word for word, and labelling the span
// separately tells the model which part of the passage to check.
// There is one exception. A claim with no highlighted span is grounded in an
// image, and a single image such as an infographic can carry several claims. In
// that case the restatement is the only thing that says which claim to check, so
// it goes back in. The images themselves reach the model through the pipeline's
// media analysis.
// The fact-check reads these fields as labelled lines of a synthetic post. The
// rating step reads them as a JSON object. Both steps judge the same words.
export function claimCheckFields(claim: ExtractedClaim, source: ItemSource): Record<string, string> {
  const origin = source === "youtube" ? "Transcript" : "Article";
  const highlighted = claim.context.trim();
  const paragraph = claim.contextParagraph.trim();
  const fields: Record<string, string> = {};
  if (highlighted) fields[`Highlighted claim from ${origin}`] = highlighted;
  else fields["Claim"] = claim.claim;
  if (paragraph) fields["Surrounding context"] = paragraph;
  return fields;
}

