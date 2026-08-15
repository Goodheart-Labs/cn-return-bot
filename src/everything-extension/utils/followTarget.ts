/** Works out whether the current page belongs to a feed a reader could ask us
 *  to follow, and whether we already cover other pages by the same author. */

export interface FollowTarget {
  feedType: "substack" | "youtube";
  /** The feed in the form the pipeline stores: the *.substack.com publication
   *  root, or the YouTube channel URL. */
  feedUrl: string;
  /** What the follow button calls the feed: "blog" or "channel". */
  kind: "blog" | "channel";
  title: string;
}

/** A Substack publication on its own subdomain. A publication on a custom
 *  domain gives null, because the pipeline can only follow the *.substack.com
 *  form (the RSS relay accepts nothing else) and that form is not derivable
 *  from the page URL. */
export function substackFollowTarget(pageUrl: string): FollowTarget | null {
  const m = new URL(pageUrl).hostname.match(/^([\w-]+)\.substack\.com$/);
  if (!m || m[1] === "www") return null;
  return { feedType: "substack", feedUrl: `https://${m[1]}.substack.com`, kind: "blog", title: m[1]! };
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

/** Whether the covered-pages list holds any page on this hostname besides the
 *  page itself. That is our on-device proxy for "we have checked this author
 *  before". It says nothing on YouTube, where every video shares a hostname. */
export function authorHasCoveredPages(pageUrl: string, covered: string[]): boolean {
  const { hostname } = new URL(pageUrl);
  const trimmed = pageUrl.replace(/\/$/, "");
  return covered.some((url) => {
    try {
      return new URL(url).hostname === hostname && url.replace(/\/$/, "") !== trimmed;
    } catch {
      return false;
    }
  });
}
