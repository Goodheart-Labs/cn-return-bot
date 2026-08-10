/** Decodes the HTML entities that leak into scraped text, such as YouTube
 *  auto-captions and Substack `body_html`. Examples are `&nbsp;`, `&#39;`,
 *  `&amp;` and `&#x27;`. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}
