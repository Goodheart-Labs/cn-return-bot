import type { ReviewDraft } from "@cn/core/claudeReview";
import { browserById } from "../../lib/extensionStores";
import X_HANDLES from "./xHandles.json";

/* The tweet the local posting tool proposes for a note, in the format Nathan
 * used by hand (PR #528): the claim with the creator's X handle, the note, how
 * many people found it helpful, and the note's link. A reply under it links to
 * the extension. Both texts can be edited before they are sent. */

/** Stands in for a creator whose X handle is not in xHandles.json. A tweet
 *  that still holds it cannot be sent. */
export const MISSING_HANDLE = "@???";

const handles: Record<string, string> = X_HANDLES;

export const EXTENSION_REPLY = `See notes like this on any article or YouTube video with the Common Notes extension:

Chrome: ${browserById("chrome").store!.url}
Firefox: ${browserById("firefox").store!.url}`;

export function tweetText(draft: ReviewDraft, noteLink: string): string {
  const handle = draft.post.creatorSlug ? handles[draft.post.creatorSlug] : undefined;
  const who = handle ? `@${handle}` : `${MISSING_HANDLE} (${draft.post.creator})`;
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
