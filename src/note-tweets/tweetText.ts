import type { FeedNote } from "./types";

export const DEFAULT_REPLY = `See notes like this on any article or YouTube video with the Common Notes extension:

Chrome: https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij
Firefox: https://addons.mozilla.org/en-US/firefox/addon/common-notes/`;
export function tweetText(d: FeedNote, handles: Record<string, string>) {
  const handle = handles[d.host] || (d.slug ? handles[d.slug] : undefined);
  const who = /^Your Book Review:/.test(d.title ?? "")
    ? `a reader's entry in the ACX book review contest${handle ? ` (hosted by @${handle})` : ""}`
    : handle ? `@${handle}` : `@??? (${d.project})`;
  const lines = [`Claim, from ${who}: "${d.quote}"`, "", `Additional context: "${d.note}"`];
  if (d.updated_quote) lines.push("", `Update: the source has since been corrected and now reads "${d.updated_quote}"`);
  if (d.helpful > 0) lines.push("", `${d.helpful} ${d.helpful === 1 ? "person" : "people"} found this helpful.`);
  lines.push("", `Link to note: ${d.url}`);
  return lines.join("\n");
}
