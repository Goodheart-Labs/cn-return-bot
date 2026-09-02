import { browser } from "#imports";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";
import { unlessFollowed } from "./followedFeeds";
import {
  forumAuthorTarget,
  forumPostAuthorTarget,
  isForumPostPage,
  readSubstackPublicationFromPage,
  resolveProfileFollowTarget,
  substackFollowTarget,
  substackProfileHandle,
  substackTargetFromPublication,
  youtubeChannelTarget,
  type FollowTarget,
} from "./followTarget";

/** Runs inside the watch page, so it must stay self-contained: executeScript
 *  serializes the function and imports would not exist over there. The visit
 *  recorder also calls it directly, because its content script IS the page. */
export function readWatchPageChannel() {
  const link = document.querySelector<HTMLAnchorElement>("ytd-video-owner-renderer ytd-channel-name a");
  return link?.href ? { href: link.href, name: link.textContent ?? "" } : null;
}

/** The feed a tab's author could be followed as: a Substack publication (from
 *  its subdomain or a profile page), a YouTube channel (from a channel page,
 *  or read out of a watch page's owner box), or a LessWrong / Alignment Forum
 *  author (from their profile page, or asked of the site's own API on a post
 *  page). Null when the page has no author feed. Reading the watch page's
 *  owner box needs the tab to be scriptable, which the popup and a
 *  context-menu click both have through activeTab. */
export async function authorFeedForTab(tab: { id?: number; url?: string; title?: string }): Promise<FollowTarget | null> {
  const url = tab.url;
  if (!url) return null;
  const subdomainTarget = substackFollowTarget(url);
  if (subdomainTarget) return subdomainTarget;
  const handle = substackProfileHandle(url);
  if (handle) return resolveProfileFollowTarget(handle);
  const channelTarget = youtubeChannelTarget(url, (tab.title ?? "").replace(/ - YouTube$/, ""));
  if (channelTarget) return channelTarget;
  // A forum profile tab is titled like "Zvi — LessWrong"; the suffix is not
  // part of the author's name.
  const forumTarget = forumAuthorTarget(url, (tab.title ?? "").replace(/\s[—–-]\s*(LessWrong|AI Alignment Forum)$/, ""));
  if (forumTarget) return forumTarget;
  if (isForumPostPage(url)) return forumPostAuthorTarget(url);
  if (extractYoutubeVideoId(url) && tab.id != null) {
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
        func: readSubstackPublicationFromPage,
      });
      const target = substackTargetFromPublication(result?.result ?? null);
      if (target) return target;
    } catch {
      // A page we may not inject into offers no follow target.
    }
  }
  return null;
}

/** How a tab relates to author feeds: it has none, it has one we already
 *  follow, or it has one that could still be followed. */
export type AuthorFeedStatus =
  | { kind: "none" }
  | { kind: "followed"; feed: FollowTarget }
  | { kind: "followable"; target: FollowTarget };

export async function authorFeedStatusForTab(tab: { id?: number; url?: string; title?: string }): Promise<AuthorFeedStatus> {
  const feed = await authorFeedForTab(tab);
  if (!feed) return { kind: "none" };
  const target = await unlessFollowed(feed);
  return target ? { kind: "followable", target } : { kind: "followed", feed };
}
