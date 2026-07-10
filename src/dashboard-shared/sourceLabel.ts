// "View on <label> ↗" text for a source link: nicer names for the common hosts,
// bare hostname (sans www) otherwise, "source" if the URL doesn't parse.
export function sourceLinkLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
  if (host === "x.com" || host === "twitter.com") return "X";
  if (host === "youtube.com" || host === "youtu.be") return "YouTube";
  return host;
}
