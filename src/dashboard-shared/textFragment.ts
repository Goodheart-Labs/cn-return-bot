/** Percent-encode a string for use inside a `#:~:text=` directive. Beyond
 *  encodeURIComponent, dashes must be escaped — `-` is directive syntax
 *  (the prefix-/-suffix markers). */
function encodeFragmentText(s: string): string {
  return encodeURIComponent(s).replace(/-/g, "%2D");
}

/** Claim quotes come from scraped markdown, but the live page renders plain
 *  text — strip markdown syntax so the fragment matches what the browser sees. */
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
 * Deep-link an article URL to its quoted passage via a scroll-to-text fragment
 * (`#:~:text=`). Long quotes use the `textStart,textEnd` form so footnote
 * markers or formatting mid-quote can't break the match. Browsers without
 * support ignore the fragment and land at the top of the page, as before.
 */
export function quoteFragmentUrl(url: string, quote: string): string {
  const text = stripMarkdown(quote);
  if (!/^https?:/i.test(url) || text.length < 12) return url;
  const words = text.split(" ");
  const directive =
    words.length <= EDGE_WORDS * 2
      ? encodeFragmentText(text)
      : `${encodeFragmentText(words.slice(0, EDGE_WORDS).join(" "))},${encodeFragmentText(words.slice(-EDGE_WORDS).join(" "))}`;
  // ":~:" must live inside the fragment, so reuse an existing "#" if present.
  return `${url}${url.includes("#") ? "" : "#"}:~:text=${directive}`;
}
