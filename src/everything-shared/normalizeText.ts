/** Normalize text for fuzzy matching across transcripts, quotes, and page
 *  content: lowercase, non-alphanumerics to spaces, whitespace collapsed.
 *  Shared by claim-extraction timestamp snapping and the extension's
 *  in-page quote anchoring, so both sides agree on what "matches". */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
