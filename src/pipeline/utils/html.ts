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

/** The placeholder we leave in the plain text where an image stood. The
 *  extractor later renders the image and its URL at that exact point in the
 *  article. */
export function imageMarker(url: string): string {
  return `[[IMAGE:${url}]]`;
}
export const IMAGE_MARKER_RE = /\[\[IMAGE:(.*?)\]\]/g;

/** Replaces each <img> tag with an inline image marker carrying its URL. An
 *  image inlined as a data URI is dropped instead, because there is no URL the
 *  image analysis could fetch. */
function imagesToMarkers(html: string): string {
  return html.replace(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, (_m, src) =>
    src.startsWith("data:") ? "" : `\n\n${imageMarker(src)}\n\n`,
  );
}

/** Strips an article's HTML, such as Substack's body_html or a forum post's
 *  htmlBody, down to plain text whose blocks are separated by blank lines.
 *  Chunking later splits the text on those blank lines. An inline `<img>` tag
 *  survives as an `[[IMAGE:url]]` marker. */
export function htmlToText(html: string): string {
  const text = imagesToMarkers(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|div|figcaption)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(text)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
