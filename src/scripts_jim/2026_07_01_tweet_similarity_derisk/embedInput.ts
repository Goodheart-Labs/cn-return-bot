/**
 * Build the text that gets embedded for a tweet from the *exact* user message
 * the pipeline formatted for a tweet, preferring the search step and falling
 * back to the prefilter's search-analyzer step:
 *   1. `logs.note_writer_steps.search.messages.0.userMessage`
 *   2. `logs.note_prefilter_steps.search_analyzer.messages.0.userMessage`
 * Both are formatted identically. Tweets whose logs have neither are skipped
 * entirely by the caller — no reconstruction from raw fields.
 *
 * We drop the parts that aren't the tweet's own content, so both sources embed
 * the same shape:
 *   - author correction history ("## Past corrections to this author's posts")
 *   - comments/replies ("## Comments and replies")
 *   - the "Made with AI" provenance label line
 *   - raw search results ("## Raw search results" → end; only the prefilter
 *     message carries these, so dropping them keeps the two sources comparable)
 * Everything else (date header, author, engagement, post, quoted post, media
 * descriptions/OCR/transcripts) is kept.
 */

// A "## " header starts a section that runs until the next "## " header.
const DROP_SECTION_PREFIXES = ["## Past corrections to this author", "## Comments and replies"];
// Sections whose "## " header runs to the end of the message (they contain nested
// "## Query:" headers, so "drop until next header" wouldn't cover them).
const DROP_TO_END_PREFIXES = ["## Raw search results"];
const AI_LABEL_MARKER = 'tagged with "Made with AI"';

/** Strip author-history + comments sections, the "Made with AI" line, and the
 *  raw-search-results tail. */
export function cleanInput(text: string): string {
  const out: string[] = [];
  let dropping = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      if (DROP_TO_END_PREFIXES.some((p) => line.startsWith(p))) break;
      dropping = DROP_SECTION_PREFIXES.some((p) => line.startsWith(p));
    }
    if (dropping) continue;
    if (line.includes(AI_LABEL_MARKER)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

function userMessageOf(stepSubtree: any): string | undefined {
  const msg = stepSubtree?.messages?.["0"]?.userMessage;
  return typeof msg === "string" && msg.length > 0 ? msg : undefined;
}

/**
 * The formatted tweet input for a run: the search-step message if present, else
 * the prefilter search-analyzer message. `searchStep` is
 * `logs.note_writer_steps.search`; `prefilterSearchAnalyzer` is
 * `logs.note_prefilter_steps.search_analyzer`. undefined if neither logged one.
 */
export function extractInputMessage(searchStep: any, prefilterSearchAnalyzer: any): string | undefined {
  return userMessageOf(searchStep) ?? userMessageOf(prefilterSearchAnalyzer);
}
