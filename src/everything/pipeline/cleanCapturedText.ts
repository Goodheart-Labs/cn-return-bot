/**
 * Cleans the page text a note request captured. The extension grabs the
 * rendered text of the whole page, and on many sites that includes comments,
 * sidebars, navigation and recommendation widgets — on one LessWrong request
 * two thirds of the captured text were comments, and one note ended up on a
 * commenter's claim. One Gemini Flash call repeats the text verbatim, keeping
 * only the article body.
 *
 * The model's output is trusted only after a check against the original: it
 * must not be truncated, must have a sensible length, and sampled excerpts of
 * it must actually appear in the input. When the call or any check fails, the
 * raw capture is used unchanged. A noisy text is better than none.
 */

import { extractOpenRouterCost, GEMINI_MODEL } from "../../pipeline/cost-tracking/pricing";
import { llm } from "../../pipeline/llm/llm";

/** Below this size there is nothing worth cleaning: the capture is either a
 *  selection-sized snippet or a page with no clutter to speak of. */
const MIN_CHARS_WORTH_CLEANING = 2000;

/** Generous ceiling for the repeated article. An article that does not fit is
 *  detected through the truncation check and the raw capture is kept. */
const MAX_OUTPUT_TOKENS = 60_000;

/** How many evenly spaced excerpts of the output are checked against the
 *  input, and how many of them must be found for the output to count as
 *  verbatim. The comparison ignores whitespace differences, because models
 *  reflow line breaks even when they copy faithfully. */
const VERBATIM_SAMPLES = 10;
const VERBATIM_SAMPLE_CHARS = 60;
const VERBATIM_MIN_HITS = 8;

const squashWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();

function looksVerbatim(cleaned: string, original: string): boolean {
  const haystack = squashWhitespace(original);
  const flat = squashWhitespace(cleaned);
  if (flat.length < VERBATIM_SAMPLE_CHARS) return false;
  let hits = 0;
  for (let i = 0; i < VERBATIM_SAMPLES; i++) {
    const start = Math.floor((i * (flat.length - VERBATIM_SAMPLE_CHARS)) / Math.max(1, VERBATIM_SAMPLES - 1));
    if (haystack.includes(flat.slice(start, start + VERBATIM_SAMPLE_CHARS))) hits++;
  }
  return hits >= VERBATIM_MIN_HITS;
}

/** Returns the article-only text of a captured page, or the input unchanged
 *  when cleaning is unnecessary or the model's output fails verification. */
export async function cleanCapturedPageText(pageText: string): Promise<string> {
  if (pageText.length < MIN_CHARS_WORTH_CLEANING) return pageText;
  try {
    const response = await llm.create({
      model: GEMINI_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user" as const,
          content: `Below is the visible text of a web page. Return the article's own text verbatim, from its first line to its last. Leave out everything that is not the article: navigation, sidebars, related-post widgets, subscription boxes, footers, and the comment section. Do not rewrite, summarize, or add anything — output only text that appears below, unchanged.\n\n${pageText}`,
        },
      ],
    });
    const choice = response.choices?.[0];
    const cleaned = choice?.message?.content?.trim() ?? "";
    const cost = extractOpenRouterCost(response);
    if (choice?.finish_reason === "length") {
      console.log(`  [capture cleanup] output truncated — keeping the raw capture (${pageText.length} chars)`);
      return pageText;
    }
    if (cleaned.length < MIN_CHARS_WORTH_CLEANING / 2 || cleaned.length > pageText.length * 1.05 || !looksVerbatim(cleaned, pageText)) {
      console.log(`  [capture cleanup] output failed verification — keeping the raw capture (${pageText.length} chars)`);
      return pageText;
    }
    console.log(
      `  [capture cleanup] ${pageText.length} → ${cleaned.length} chars ($${(cost?.cost ?? 0).toFixed(4)})`,
    );
    return cleaned;
  } catch (err: any) {
    console.warn(`  [capture cleanup] failed (${err?.message}) — keeping the raw capture`);
    return pageText;
  }
}
