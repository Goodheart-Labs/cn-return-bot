/** Works out whether the current page belongs to a feed a reader could ask us
 *  to follow. Whether that feed is already followed is a separate question,
 *  answered by feedIsFollowed in followedFeeds.ts against the synced list. */

export interface FollowTarget {
  feedType: "substack" | "youtube";
  /** The feed in the form the pipeline stores: the *.substack.com publication
   *  root, or the YouTube channel URL. */
  feedUrl: string;
  /** What the follow button calls the person: "author" or "youtuber". */
  kind: "author" | "youtuber";
  title: string;
}

export const followButtonLabel = (target: FollowTarget) => `Request notes on all new posts from this ${target.kind}`;
export const followDoneLabel = (target: FollowTarget) => `Requested. We'll check new posts from this ${target.kind}.`;

/** A Substack publication on its own subdomain. A publication on a custom
 *  domain gives null, because the pipeline can only follow the *.substack.com
 *  form (the RSS relay accepts nothing else) and that form is not derivable
 *  from the page URL. */
export function substackFollowTarget(pageUrl: string): FollowTarget | null {
  const m = new URL(pageUrl).hostname.match(/^([\w-]+)\.substack\.com$/);
  if (!m || m[1] === "www") return null;
  return { feedType: "substack", feedUrl: `https://${m[1]}.substack.com`, kind: "author", title: m[1]! };
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
