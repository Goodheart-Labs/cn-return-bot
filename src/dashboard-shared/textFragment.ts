/** Percent-encodes a string so it can sit inside a `#:~:text=` directive. On top
 *  of what encodeURIComponent does, dashes have to be escaped as well. A dash is
 *  part of the directive's own syntax, where it separates the prefix and suffix
 *  markers from the text. */
function encodeFragmentText(s: string): string {
  return encodeURIComponent(s).replace(/-/g, "%2D");
}

/** Claim quotes are taken from scraped markdown, while the live page shows plain
 *  text. Stripping the markdown syntax makes the fragment match what the browser
 *  actually sees. */
function stripMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const EDGE_WORDS = 6;

/**
 * Builds a deep link from an article URL to its quoted passage, using a
 * scroll-to-text fragment (`#:~:text=`). A long quote is linked by its first and
 * its last few words, which is the `textStart,textEnd` form. A footnote marker
 * or some formatting in the middle of the quote then cannot break the match. A
 * browser that does not support the fragment ignores it and lands at the top of
 * the page.
 */
export function quoteFragmentUrl(url: string, quote: string): string {
  const text = stripMarkdown(quote);
  if (!/^https?:/i.test(url) || text.length < 12) return url;
  const words = text.split(" ");
  const directive =
    words.length <= EDGE_WORDS * 2
      ? encodeFragmentText(text)
      : `${encodeFragmentText(words.slice(0, EDGE_WORDS).join(" "))},${encodeFragmentText(words.slice(-EDGE_WORDS).join(" "))}`;
  // The ":~:" part must sit inside the URL's fragment. When the URL already has
  // a "#" we append to it instead of adding a second one.
  return `${url}${url.includes("#") ? "" : "#"}:~:text=${directive}`;
}
