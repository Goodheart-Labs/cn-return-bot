import type { ExtractedClaim, ItemSource } from "../types";

// The claim check reads three things. The first is the extractor's neutral
// restatement of the claim, which says exactly which claim to check. The second
// is the author's verbatim words where the claim was made. The third is the
// passage around them, which contains those words word for word. The restatement
// can drift away from the source, so the author's own words always come with it
// and the search model can compare the two.
// A claim with no verbatim words rests on an image, and a single image such as
// an infographic can carry several claims. There the restatement is the only
// thing that says which claim to check. The images themselves reach the model
// through the pipeline's media analysis.
// A passage that a reader highlighted is its own restatement, so the restatement
// is left out when it equals the verbatim words.
// The fact-check reads these fields as labelled lines of a synthetic post. The
// rating step reads them as a JSON object. Both steps judge the same words.
export function claimCheckFields(claim: ExtractedClaim, source: ItemSource): Record<string, string> {
  const origin = source === "youtube" ? "Transcript" : "Article";
  const highlighted = claim.context.trim();
  const paragraph = claim.contextParagraph.trim();
  const fields: Record<string, string> = {};
  if (claim.claim.trim() !== highlighted) fields["Claim"] = claim.claim;
  if (highlighted) fields[`Highlighted claim from ${origin}`] = highlighted;
  if (paragraph) fields["Surrounding context"] = paragraph;
  if (claim.steer) fields["A reader asked for a note about"] = claim.steer.replace(/\s+/g, " ").trim();
  return fields;
}

