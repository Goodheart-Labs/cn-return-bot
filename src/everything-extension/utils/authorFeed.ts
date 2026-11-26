import { browser } from "#imports";
import { extractYoutubeVideoId } from "@cn/core/pageUrls";
import { publicationInPreloads, substackReaderPostId } from "@cn/core/substack";
import { unlessPrioritized } from "./prioritizedCreators";
import {
  forumAuthorFromPageLink,
  forumAuthorTarget,
  forumPostAuthorTarget,
  isForumPostPage,
  readForumPostAuthorFromPage,
  readWatchPageChannel,
  youtubeChannelTarget,
  youtubeVideoChannelTarget,
  type CreatorTarget,
} from "./creatorTarget";
import {
  readSubstackPreloads,
  resolveProfileCreatorTarget,
  substackCreatorTarget,
  substackProfileHandle,
  substackTargetFromPublication,
} from "./substackCreator";
import { fetchSubstackPostCreator } from "./substackPostCreator";

/** A content script sends this to learn its own tab's creator. The background
 *  answers with the creator's feed URL, or null when the page has none. */
export const TAB_CREATOR_MESSAGE_TYPE = "cn-tab-creator";

/** The creator a tab belongs to: a Substack publication (from its subdomain,
 *  the post a reader-app address leads to, a profile page, or the page's own
 *  data on a custom domain), a YouTube channel (from a channel page, or on a watch
 *  page asked of YouTube's oEmbed endpoint, or read out of the page when that
 *  does not answer), or a forum author (from their profile page, or on a post
 *  page asked of the site's own API, or read out of the page when the API does
 *  not answer). Null when the page has no creator. Reading a page needs the
 *  tab to be scriptable, which the popup and a context-menu click both have
 *  through activeTab. */
export async function authorFeedForTab(tab: { id?: number; url?: string; title?: string }): Promise<CreatorTarget | null> {
  const url = tab.url;
  if (!url) return null;
  const subdomainTarget = substackCreatorTarget(url);
  if (subdomainTarget) return subdomainTarget;
  // A post in Substack's reader app belongs to its publication, which is not
  // always the author's own: a guest post sits in someone else's.
  if (substackReaderPostId(url)) return fetchSubstackPostCreator(url);
  const handle = substackProfileHandle(url);
  if (handle) return resolveProfileCreatorTarget(handle);
  const channelTarget = youtubeChannelTarget(url, (tab.title ?? "").replace(/ - YouTube$/, ""));
  if (channelTarget) return channelTarget;
  // A forum profile tab is titled like "Zvi — LessWrong"; the suffix is not
  // part of the author's name.
  const forumTarget = forumAuthorTarget(url, (tab.title ?? "").replace(/\s[—–-]\s*(LessWrong|AI Alignment Forum|EA Forum)$/, ""));
  if (forumTarget) return forumTarget;
  if (isForumPostPage(url)) return (await forumPostAuthorTarget(url)) ?? (await forumPostAuthorFromTab(tab.id));
  const videoId = extractYoutubeVideoId(url);
  const uploader = videoId ? await youtubeVideoChannelTarget(videoId) : null;
  if (uploader) return uploader;
  if (videoId && tab.id != null) {
    try {
      const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: readWatchPageChannel });
      const channel = result?.result as { href: string; name: string } | null;
      if (channel) return youtubeChannelTarget(channel.href, channel.name.trim());
    } catch {
      // A page we may not inject into offers no follow target.
    }
  }
  // A Substack newsletter on a custom domain names its *.substack.com form
  // inside the page, so the page itself is asked last. On any page that is
  // not Substack this reads nothing and stays a follow-less answer.
  if (tab.id != null) {
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: readSubstackPreloads,
      });
      const target = substackTargetFromPublication(publicationInPreloads(result?.result));
      if (target) return target;
    } catch {
      // A page we may not inject into offers no follow target.
    }
  }
  return null;
}

/** Reads a forum post's author out of the open tab. */
async function forumPostAuthorFromTab(tabId: number | undefined): Promise<CreatorTarget | null> {
  if (tabId == null) return null;
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func: readForumPostAuthorFromPage });
    return forumAuthorFromPageLink(result?.result ?? null);
  } catch {
    // A page we may not inject into offers no follow target.
    return null;
  }
}

/** How a tab relates to creators: it has none, it has one whose priority window
 *  is already open, or it has one a reader could press. Both kinds with a
 *  creator name it in the same field. A check request needs the creator in
 *  both cases, and until 2026-11-26 the request read it only from a pressable
 *  creator, so every page requested during a priority window was filed under
 *  Around the web. */
export type AuthorFeedStatus =
  | { kind: "none" }
  | { kind: "prioritized" | "pressable"; creator: CreatorTarget };

export async function authorFeedStatusForTab(tab: { id?: number; url?: string; title?: string }): Promise<AuthorFeedStatus> {
  const creator = await authorFeedForTab(tab);
  if (!creator) return { kind: "none" };
  return { kind: (await unlessPrioritized(creator)) ? "pressable" : "prioritized", creator };
}
