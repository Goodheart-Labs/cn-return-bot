import type { ExtractedClaim, ItemSource } from "../types";

// The fact-check reads the passage the claim was made in and the extractor's
// neutral restatement of the claim. The passage gives the context and the
// restatement says exactly which claim to check. A claim that rests only on an
// image has no passage, so it gets just the restatement, and the images reach
// the model through the pipeline's media analysis.
// The fact-check reads these fields as labelled lines of a synthetic post. The
// rating step reads them as a JSON object. Both steps judge the same words.
export function claimCheckFields(claim: ExtractedClaim, source: ItemSource): Record<string, string> {
  const origin = source === "youtube" ? "Transcript" : "Article";
  const passage = (claim.contextParagraph || claim.context).trim();
  const fields: Record<string, string> = {};
  if (passage) fields[`Text from ${origin}`] = passage;
  fields["Claim"] = claim.claim;
  if (claim.steer) fields["A reader asked for a note about"] = claim.steer.replace(/\s+/g, " ").trim();
  return fields;
}
