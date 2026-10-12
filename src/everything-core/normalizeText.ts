/** Normalizes text so that transcripts, quotes and page content can be matched
 *  loosely. It lowercases the text, turns everything that is not a letter or a digit
 *  into a space, and collapses runs of whitespace. Claim extraction uses it to snap
 *  timestamps and the extension uses it to anchor quotes in a page, so both sides
 *  agree on what counts as a match. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
