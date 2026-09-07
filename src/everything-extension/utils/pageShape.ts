/** What kind of page a URL points at. These answer the note-request button's
 *  question ("is there anything here worth asking us to check?"), not the
 *  creator question, which lives in creatorTarget.ts. */

import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";

/** Substack post pages live under /p/, on subdomains and custom domains alike.
 *  The "we have not checked this yet" overlay only makes sense on a post, not
 *  on a homepage or an archive. */
export function isSubstackPostPage(pageUrl: string): boolean {
  try {
    return new URL(pageUrl).pathname.startsWith("/p/");
  } catch {
    return false;
  }
}

/** Whether requesting a check makes sense for this URL. On the platforms
 *  whose URL shapes we know, only an actual post or video is checkable:
 *  youtube.com must be a watch page, a substack.com host must be a /p/ post
 *  (so messages, inboxes and profiles offer nothing), lesswrong.com must be a
 *  /posts/ page. Any other site keeps the offer, because we cannot know its
 *  URL shapes and a wrong guess would hide the feature. The search-engine
 *  exclusion lives separately in the popup. */
export function requestMakesSenseForUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    if (/(^|\.)youtube\.com$/.test(url.hostname)) return !!extractYoutubeVideoId(pageUrl);
    if (/(^|\.)substack\.com$/.test(url.hostname)) return isSubstackPostPage(pageUrl);
    if (/(^|\.)lesswrong\.com$/.test(url.hostname)) return url.pathname.startsWith("/posts/");
    return true;
  } catch {
    return false;
  }
}
