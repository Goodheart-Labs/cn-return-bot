import type { ReviewDraft } from "@cn/core/claudeReview";
import { browserById } from "../../lib/extensionStores";

/* The tweet the local posting tool proposes for a note, in the format Nathan
 * used by hand (PR #528): the claim with the creator's X handle, the note, how
 * many people found it helpful, and the note's link. A reply under it links to
 * the extension. Both texts can be edited before they are sent. The handle is
 * the creator's X account (migration 154). A creator without one is named
 * instead. */

/** Stands in for a creator whose X account nobody has looked up yet. A tweet
 *  that still holds it cannot be sent. */
export const MISSING_HANDLE = "@???";

export const EXTENSION_REPLY = `See notes like this on any article or YouTube video with the Common Notes extension:

Chrome: ${browserById("chrome").store!.url}
Firefox: ${browserById("firefox").store!.url}`;

/** A commonnotes.net link as it goes into a tweet. The pageview event keeps
 *  the query string, so visits from X are counted by `utm_source=x` and the
 *  tweet's note by `utm_content`. */
export function taggedForX(link: string, noteId: string): string {
  const url = new URL(link);
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_campaign", "note");
  url.searchParams.set("utm_content", noteId);
  return url.toString();
}

export function tweetText(draft: ReviewDraft, noteLink: string): string {
  const who =
    draft.fields.creator_x === "found" ? `@${draft.fields.creator_x_handle}` : draft.fields.creator_x === "none" ? draft.post.creator : `${MISSING_HANDLE} (${draft.post.creator})`;
  const helpful = draft.fields.helpful_votes as number;
  return [
    `Claim, from ${who}: "${draft.passage}"`,
    "",
    `Additional context: "${draft.note}"`,
    ...(helpful > 0 ? ["", `${helpful} ${helpful === 1 ? "person" : "people"} found this helpful.`] : []),
    "",
    `Link to note: ${noteLink}`,
  ].join("\n");
}
