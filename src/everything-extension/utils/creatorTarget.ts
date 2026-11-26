
/** Works out which creator the current page belongs to, so a reader can ask us
 *  to check their new posts. Substack's creators live in substackCreator.ts. Whether that creator is already prioritised is a
 *  separate question, answered by unlessPrioritized in prioritizedCreators.ts
 *  against the synced list. */
import { youtubeWatchUrl } from "@cn/core/pageUrls";
import { fetchWithRetries } from "@cn/core/retry";

const YOUTUBE_OEMBED_URL = "https://www.youtube.com/oembed";

export interface CreatorTarget {
  feedType: "substack" | "youtube" | "lesswrong";
  /** The feed in the form the pipeline stores: the *.substack.com publication
   *  root, the YouTube channel URL, or the forum author's profile URL. */
  feedUrl: string;
  /** What the follow button calls the person: "author" or "youtuber". */
  kind: "author" | "youtuber";
  title: string;
}

/* A press buys a week of checking, so the copy says a week rather than
 * promising forever. The reader can press again once it lapses. */
export const priorityButtonLabel = (target: CreatorTarget) =>
  target.kind === "youtuber" ? "Check this youtuber's new videos" : "Check this author's new posts";
export const priorityDoneLabel = (target: CreatorTarget) =>
  target.kind === "youtuber"
    ? "Done. We'll check this youtuber's new videos this week."
    : "Done. We'll check this author's new posts this week.";
/** What the popup says about a creator whose window is already open. */
export const priorityActiveLabel = (kind: CreatorTarget["kind"]) =>
  kind === "youtuber"
    ? "We're checking this youtuber's new videos this week."
    : "We're checking this author's new posts this week.";

/** LessWrong, the Alignment Forum and the EA Forum all run ForumMagnum, the
 *  same forum codebase. One feed type covers all three; the host in the feed
 *  URL says which site's posts the pipeline walks. LessWrong and the Alignment
 *  Forum share their user accounts. The EA Forum has accounts of its own, so
 *  the same slug there may be someone else. */
const FORUM_HOSTNAMES: Record<string, string> = {
  "lesswrong.com": "https://www.lesswrong.com",
  "alignmentforum.org": "https://www.alignmentforum.org",
  "forum.effectivealtruism.org": "https://forum.effectivealtruism.org",
};

/** The EA Forum, whose visits have a setting of their own (utils/settings.ts). */
export const EA_FORUM_ORIGIN = "https://forum.effectivealtruism.org";

/** The canonical origin for a forum URL, or null when the URL belongs to none
 *  of the forums. */
export function forumOrigin(pageUrl: string): string | null {
  try {
    const hostname = new URL(pageUrl).hostname.replace(/^www\./, "");
    return FORUM_HOSTNAMES[hostname] ?? null;
  } catch {
    return null;
  }
}

/** True for a forum post page, so a /posts/<id>/... path on any of the forums. */
export function isForumPostPage(pageUrl: string): boolean {
  try {
    return forumOrigin(pageUrl) !== null && new URL(pageUrl).pathname.startsWith("/posts/");
  } catch {
    return false;
  }
}

/** The creator target for a forum author page such as lesswrong.com/users/zvi.
 *  `title` is the author's name as the caller knows it; without one the slug
 *  stands in, and the pipeline fills in the real display name when it lists
 *  the feed. Null when the URL is not an author page. */
export function forumAuthorTarget(pageUrl: string, title?: string): CreatorTarget | null {
  const origin = forumOrigin(pageUrl);
  if (!origin) return null;
  const slug = new URL(pageUrl).pathname.match(/^\/users\/([\w.-]+)\/?$/)?.[1]?.toLowerCase();
  if (!slug) return null;
  return { feedType: "lesswrong", feedUrl: `${origin}/users/${slug}`, kind: "author", title: title?.trim() || slug };
}

/** Resolves a forum post page to its author's creator target by asking the
 *  site's own GraphQL API for the post's author. The post id sits in the URL
 *  path. Null when the URL is not a post or the API call failed. The EA Forum
 *  can answer such a request with its bot check, so callers then read the
 *  author from the page itself (readForumPostAuthorFromPage). */
export async function forumPostAuthorTarget(pageUrl: string): Promise<CreatorTarget | null> {
  const origin = forumOrigin(pageUrl);
  const postId = isForumPostPage(pageUrl) ? new URL(pageUrl).pathname.match(/^\/posts\/(\w+)/)?.[1] : null;
  if (!origin || !postId) return null;
  try {
    // The query goes out as a GET request, which marks it as a read, so a
    // failed attempt is tried again.
    const query = `{ post(input: {selector: {_id: "${postId}"}}) { result { user { slug displayName } } } }`;
    const res = await fetchWithRetries(`${origin}/graphql?query=${encodeURIComponent(query)}`, { credentials: "omit" });
    if (!res.ok) return null;
    const user = (await res.json())?.data?.post?.result?.user;
    if (!user?.slug) return null;
    return forumAuthorTarget(`${origin}/users/${user.slug}`, user.displayName);
  } catch {
    return null;
  }
}

/** Runs inside a forum post page, so it must stay self-contained: the
 *  background passes it to executeScript, which serializes the function, and
 *  the visit recorder calls it directly, because its content script IS the
 *  page. Every forum marks the link to the post's author in the post header
 *  with "from=post_header". */
export function readForumPostAuthorFromPage(): { href: string; name: string } | null {
  const link = document.querySelector<HTMLAnchorElement>('a[href^="/users/"][href*="from=post_header"]');
  if (!link) return null;
  const name = link.textContent?.trim() || document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content || "";
  return { href: link.href.split("?")[0]!, name };
}

/** The creator target for an author link read out of a post page. */
export function forumAuthorFromPageLink(link: { href: string; name: string } | null): CreatorTarget | null {
  return link ? forumAuthorTarget(link.href, link.name) : null;
}

/** The channel path of a YouTube channel page such as youtube.com/@veritasium
 *  or youtube.com/channel/UC…, including its tab subpages. Null on watch pages
 *  and everything else. */
export function youtubeChannelPath(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/^\/(@[\w.-]+|channel\/[\w-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Asks YouTube's oEmbed endpoint which channel uploaded a video. The answer
 *  belongs to the video id. So unlike the watch page, which YouTube updates
 *  some time after it switched videos in place, it can never name the channel
 *  of the video the reader watched before. Null when YouTube does not answer,
 *  for example for a video whose owner turned off embedding. Callers then read
 *  the channel from the page itself (readWatchPageChannel). */
export async function youtubeVideoChannelTarget(videoId: string): Promise<CreatorTarget | null> {
  try {
    const res = await fetchWithRetries(`${YOUTUBE_OEMBED_URL}?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`, { credentials: "omit" });
    if (!res.ok) return null;
    const { author_url: channelUrl, author_name: channelName } = (await res.json()) as { author_url?: string; author_name?: string };
    return channelUrl ? youtubeChannelTarget(channelUrl, channelName ?? "") : null;
  } catch {
    return null;
  }
}

/** Reads the channel that uploaded the video out of a YouTube watch page. On
 *  most videos the owner box under the video links it. A collaboration video
 *  names several channels in its owner box and links none of them, and YouTube
 *  hides the usual channel name there. So for such a video we read the channel
 *  card at the end of the description, which links the uploader on every
 *  video. The hidden channel name can still hold the link of the previous
 *  video after YouTube switched videos in place, so it is never read.
 *  This function runs inside the watch page, so it must stay self-contained:
 *  executeScript serializes the function and imports would not exist over
 *  there. The visit recorder also calls it directly, because its content
 *  script IS the page. */
export function readWatchPageChannel() {
  const ownerLink = document.querySelector<HTMLAnchorElement>("ytd-video-owner-renderer ytd-channel-name:not([hidden]) a");
  if (ownerLink?.href) return { href: ownerLink.href, name: ownerLink.textContent ?? "" };
  const cardLink = document.querySelector<HTMLAnchorElement>("ytd-watch-metadata ytd-video-description-infocards-section-renderer a#header");
  return cardLink?.href ? { href: cardLink.href, name: cardLink.querySelector("#title")?.textContent ?? "" } : null;
}

/** The follow target for a YouTube channel link or channel page URL. `title`
 *  is the channel name as the caller knows it. Null when the URL is not a
 *  channel path. */
export function youtubeChannelTarget(href: string, title: string): CreatorTarget | null {
  const path = youtubeChannelPath(href);
  if (!path) return null;
  return { feedType: "youtube", feedUrl: `https://www.youtube.com/${path}`, kind: "youtuber", title };
}
