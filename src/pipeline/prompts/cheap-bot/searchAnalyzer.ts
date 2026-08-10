/**
 * Prompt — cheap-bot search analyzer (Stage 2b).
 *
 * The analyzer distills raw search results into a research brief. The output is
 * free text rather than JSON, so the model can reason before it concludes. See
 * runSearchAnalyzer in src/pipeline/cheap-bot/searchAnalyzer.ts.
 */

export const SEARCH_ANALYZER_SYSTEM_PROMPT = `You receive a social-media post and raw search results. Distill them into a research brief.

Think step by step: what does the post claim, what do the search results say, and if the post is wrong, what's actually true?

Write a brief (a few paragraphs) with specific names, dates, numbers, and all relevant source URLs inline (Its important that you include the full source URLs). Only use information from the search results.

If a reference document is provided, treat it as ground truth for the topic and include its Source URL inline as a citation.`;

/** `referenceBlock` is the ground-truth article of the misinfo pre-pass. It
 *  arrives already formatted and ending in a newline. In the regular pipeline it
 *  is the empty string. */
export function buildSearchAnalyzerUserMessage(params: {
  referenceBlock: string;
  postContext: string;
  rawFindings: string;
}): string {
  return `${params.referenceBlock}${params.postContext}\n\n## Raw search results\n\n${params.rawFindings}`;
}
