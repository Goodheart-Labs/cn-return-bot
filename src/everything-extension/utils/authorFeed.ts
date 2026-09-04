import { browser } from "#imports";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";
import { unlessPrioritized } from "./prioritizedCreators";
import {
  readSubstackPublicationFromPage,
  resolveProfileCreatorTarget,
  substackCreatorTarget,
  substackProfileHandle,
  substackTargetFromPublication,
  youtubeChannelTarget,
  type CreatorTarget,
} from "./creatorTarget";

/** Runs inside the watch page, so it must stay self-contained: executeScript
 *  serializes the function and imports would not exist over there. The visit
 *  recorder also calls it directly, because its content script IS the page. */
export function readWatchPageChannel() {
  const link = document.querySelector<HTMLAnchorElement>("ytd-video-owner-renderer ytd-channel-name a");
  return link?.href ? { href: link.href, name: link.textContent ?? "" } : null;
}

/** The creator a tab belongs to: a Substack publication (from
 *  its subdomain or a profile page) or a YouTube channel (from a channel page,
 *  or read out of a watch page's owner box). Null when the page has no author
 *  feed. Reading the watch page's owner box needs the tab to be scriptable,
 *  which the popup and a context-menu click both have through activeTab. */
export async function authorFeedForTab(tab: { id?: number; url?: string; title?: string }): Promise<CreatorTarget | null> {
  const url = tab.url;
  if (!url) return null;
  const subdomainTarget = substackCreatorTarget(url);
  if (subdomainTarget) return subdomainTarget;
  const handle = substackProfileHandle(url);
  if (handle) return resolveProfileCreatorTarget(handle);
  const channelTarget = youtubeChannelTarget(url, (tab.title ?? "").replace(/ - YouTube$/, ""));
  if (channelTarget) return channelTarget;
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

/** How a tab relates to creators: it has none, it has one whose priority window
 *  is already open, or it has one a reader could press. */
export type AuthorFeedStatus =
  | { kind: "none" }
  | { kind: "prioritized"; feed: CreatorTarget }
  | { kind: "pressable"; target: CreatorTarget };

export async function authorFeedStatusForTab(tab: { id?: number; url?: string; title?: string }): Promise<AuthorFeedStatus> {
  const feed = await authorFeedForTab(tab);
  if (!feed) return { kind: "none" };
  const target = await unlessPrioritized(feed);
  return target ? { kind: "pressable", target } : { kind: "prioritized", feed };
}
