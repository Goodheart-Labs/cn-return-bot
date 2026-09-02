import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";

/** Works out whether the current page belongs to a feed a reader could ask us
 *  to follow. Whether that feed is already followed is a separate question,
 *  answered by feedIsFollowed in followedFeeds.ts against the synced list. */

export interface FollowTarget {
  feedType: "substack" | "youtube" | "lesswrong";
  /** The feed in the form the pipeline stores: the *.substack.com publication
   *  root, the YouTube channel URL, or the forum author's profile URL. */
  feedUrl: string;
  /** What the follow button calls the person: "author" or "youtuber". */
  kind: "author" | "youtuber";
  title: string;
}

export const followButtonLabel = (target: FollowTarget) => `Request notes on all new posts from this ${target.kind}`;
export const followDoneLabel = (target: FollowTarget) => `Requested. We'll check new posts from this ${target.kind}.`;

/** A Substack publication on its own subdomain. A publication on a custom
 *  domain gives null here, because the *.substack.com form the pipeline needs
 *  (the RSS relay accepts nothing else) is not derivable from the page URL.
 *  For those, readSubstackPublicationFromPage reads it out of the page. */
export function substackFollowTarget(pageUrl: string): FollowTarget | null {
  const m = new URL(pageUrl).hostname.match(/^([\w-]+)\.substack\.com$/);
  if (!m || m[1] === "www") return null;
  return { feedType: "substack", feedUrl: `https://${m[1]}.substack.com`, kind: "author", title: m[1]! };
}

/** Reads the publication's identity out of a Substack page itself, which is
 *  how a newsletter on a custom domain becomes followable. Every Substack
 *  page embeds its publication data as an escaped JSON blob inside a script
 *  tag, and that raw text is visible to a content script even though the
 *  page's own JavaScript variables are not. The subdomain in that blob is the
 *  *.substack.com form the follow pipeline needs. Null on any page that is
 *  not Substack.
 *
 *  This also runs inside the page via executeScript for the popup, so it must
 *  stay self-contained: the serialized function has no imports over there. */
export function readSubstackPublicationFromPage(): { subdomain: string; name: string } | null {
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (!text.includes("_preloads")) continue;
    // The blob is JSON inside a JSON string, so the quotes around the value
    // usually arrive escaped. The pattern tolerates both forms.
    const m = text.match(/subdomain\\?":\\?"([\w-]+)\\?"/);
    if (!m) continue;
    const name = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
    return { subdomain: m[1]!, name: name || m[1]! };
  }
  return null;
}

/** The follow target for a publication read out of a page. */
export function substackTargetFromPublication(pub: { subdomain: string; name: string } | null): FollowTarget | null {
  if (!pub) return null;
  return { feedType: "substack", feedUrl: `https://${pub.subdomain}.substack.com`, kind: "author", title: pub.name };
}

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
 *  (so messages, inboxes and profiles offer nothing), a forum host must be a
 *  /posts/ page. Any other site keeps the offer, because we cannot know its
 *  URL shapes and a wrong guess would hide the feature. The search-engine
 *  exclusion lives separately in the popup. */
export function requestMakesSenseForUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    if (/(^|\.)youtube\.com$/.test(url.hostname)) return !!extractYoutubeVideoId(pageUrl);
    if (/(^|\.)substack\.com$/.test(url.hostname)) return isSubstackPostPage(pageUrl);
    if (forumOrigin(pageUrl)) return isForumPostPage(pageUrl);
    return true;
  } catch {
    return false;
  }
}

/** LessWrong and the Alignment Forum both run ForumMagnum, the same forum
 *  codebase, and share their user accounts. One feed type covers both; the
 *  host in the feed URL says which site's posts the pipeline walks. */
const FORUM_HOSTNAMES: Record<string, string> = {
  "lesswrong.com": "https://www.lesswrong.com",
  "alignmentforum.org": "https://www.alignmentforum.org",
};

/** The canonical origin for a LessWrong or Alignment Forum URL, or null when
 *  the URL belongs to neither site. */
export function forumOrigin(pageUrl: string): string | null {
  try {
    const hostname = new URL(pageUrl).hostname.replace(/^www\./, "");
    return FORUM_HOSTNAMES[hostname] ?? null;
  } catch {
    return null;
  }
}

/** True for a forum post page, so a /posts/<id>/... path on either site. */
export function isForumPostPage(pageUrl: string): boolean {
  try {
    return forumOrigin(pageUrl) !== null && new URL(pageUrl).pathname.startsWith("/posts/");
  } catch {
    return false;
  }
}

/** The follow target for a forum author page such as lesswrong.com/users/zvi.
 *  `title` is the author's name as the caller knows it; without one the slug
 *  stands in, and the pipeline fills in the real display name when it lists
 *  the feed. Null when the URL is not an author page. */
export function forumAuthorTarget(pageUrl: string, title?: string): FollowTarget | null {
  const origin = forumOrigin(pageUrl);
  if (!origin) return null;
  const slug = new URL(pageUrl).pathname.match(/^\/users\/([\w.-]+)\/?$/)?.[1]?.toLowerCase();
  if (!slug) return null;
  return { feedType: "lesswrong", feedUrl: `${origin}/users/${slug}`, kind: "author", title: title?.trim() || slug };
}

/** Resolves a forum post page to its author's follow target by asking the
 *  site's own GraphQL API for the post's author. The post id sits in the URL
 *  path. Null when the URL is not a post or the API call failed. */
export async function forumPostAuthorTarget(pageUrl: string): Promise<FollowTarget | null> {
  const origin = forumOrigin(pageUrl);
  const postId = isForumPostPage(pageUrl) ? new URL(pageUrl).pathname.match(/^\/posts\/(\w+)/)?.[1] : null;
  if (!origin || !postId) return null;
  try {
    const res = await fetch(`${origin}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        query: `{ post(input: {selector: {_id: "${postId}"}}) { result { user { slug displayName } } } }`,
      }),
    });
    if (!res.ok) return null;
    const user = (await res.json())?.data?.post?.result?.user;
    if (!user?.slug) return null;
    return forumAuthorTarget(`${origin}/users/${user.slug}`, user.displayName);
  } catch {
    return null;
  }
}

/** The handle of a Substack profile page such as substack.com/@thezvi, or null
 *  when the URL is not a profile. */
export function substackProfileHandle(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (!/^(www\.)?substack\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/^\/@([\w.-]+)(\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Resolves a profile handle to the author's publication through Substack's
 *  public profile API. This works for custom-domain newsletters too, because
 *  the API knows their *.substack.com form, which is not derivable from their
 *  page URLs. Null when the author has no publication or the API call
 *  failed. */
export async function resolveProfileFollowTarget(handle: string): Promise<FollowTarget | null> {
  try {
    const res = await fetch(`https://substack.com/api/v1/user/${handle}/public_profile`, { credentials: "omit" });
    if (!res.ok) return null;
    const profile = await res.json();
    const publication = profile.primaryPublication ?? profile.publicationUsers?.[0]?.publication;
    const subdomain = publication?.subdomain;
    if (!subdomain) return null;
    return {
      feedType: "substack",
      feedUrl: `https://${subdomain}.substack.com`,
      kind: "author",
      title: publication.name ?? subdomain,
    };
  } catch {
    return null;
  }
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

/** The follow target for a YouTube channel link or channel page URL. `title`
 *  is the channel name as the caller knows it. Null when the URL is not a
 *  channel path. */
export function youtubeChannelTarget(href: string, title: string): FollowTarget | null {
  const path = youtubeChannelPath(href);
  if (!path) return null;
  return { feedType: "youtube", feedUrl: `https://www.youtube.com/${path}`, kind: "youtuber", title };
}
