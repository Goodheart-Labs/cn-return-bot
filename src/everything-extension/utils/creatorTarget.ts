
/** Works out which creator the current page belongs to, so a reader can ask us
 *  to check their new posts. Whether that creator is already prioritised is a
 *  separate question, answered by unlessPrioritized in prioritizedCreators.ts
 *  against the synced list. */

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

/** A Substack publication on its own subdomain. A publication on a custom
 *  domain gives null here, because the *.substack.com form the pipeline needs
 *  (the RSS relay accepts nothing else) is not derivable from the page URL.
 *  For those, readSubstackPublicationFromPage reads it out of the page. */
export function substackCreatorTarget(pageUrl: string): CreatorTarget | null {
  const m = new URL(pageUrl).hostname.match(/^([\w-]+)\.substack\.com$/);
  if (!m || m[1] === "www") return null;
  return { feedType: "substack", feedUrl: `https://${m[1]}.substack.com`, kind: "author", title: m[1]! };
}

/** Reads the publication's identity out of a Substack page itself, which is
 *  how a newsletter on a custom domain becomes followable. Every Substack
 *  page embeds its data as JSON in `<script type="application/json"
 *  id="preloads-json">`, and the text of that tag is visible to a content
 *  script even though the page's own JavaScript variables are not. The
 *  object's `pub` is the publication the page belongs to, and its subdomain
 *  is the *.substack.com form the follow pipeline needs. Null on any page
 *  that is not Substack.
 *
 *  Until about 2026-10-16 Substack put this data into an inline script that
 *  assigned `window._preloads`, as an escaped string. It then moved it into
 *  the JSON tag, and newsletters on their own domain stopped being recognised
 *  for a month (GOO-774).
 *
 *  On substack.com itself the answer is always null. Those pages are the
 *  reader's own feed, inbox and profiles, so the blob describes the reader
 *  rather than one creator. Its first subdomain can be the logged-in reader's
 *  own publication. It can also be a post opened earlier, because Substack
 *  switches pages there without reloading them. The popup used to offer that
 *  stranger's posts on the home page (GOO-394). A profile page on
 *  substack.com names its creator in the address instead.
 *
 *  This also runs inside the page via executeScript for the popup, so it must
 *  stay self-contained: the serialized function has no imports over there. */
export function readSubstackPublicationFromPage(): { subdomain: string; name: string } | null {
  if (/^(www\.)?substack\.com$/.test(location.hostname)) return null;
  const preloads = document.querySelector('script#preloads-json[type="application/json"]')?.textContent;
  if (!preloads) return null;
  let pub: { subdomain?: unknown; name?: unknown } | undefined;
  try {
    pub = JSON.parse(preloads)?.pub;
  } catch {
    // Some other site's tag with the same id is not a Substack publication.
    return null;
  }
  if (typeof pub?.subdomain !== "string" || !/^[\w-]+$/.test(pub.subdomain)) return null;
  const name = typeof pub.name === "string" ? pub.name.trim() : "";
  return { subdomain: pub.subdomain, name: name || pub.subdomain };
}

/** The follow target for a publication read out of a page. */
export function substackTargetFromPublication(pub: { subdomain: string; name: string } | null): CreatorTarget | null {
  if (!pub) return null;
  return { feedType: "substack", feedUrl: `https://${pub.subdomain}.substack.com`, kind: "author", title: pub.name };
}

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
export async function resolveProfileCreatorTarget(handle: string): Promise<CreatorTarget | null> {
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

/** Reads the channel out of a YouTube watch page's owner box. It runs inside
 *  the watch page, so it must stay self-contained: executeScript
 *  serializes the function and imports would not exist over there. The visit
 *  recorder also calls it directly, because its content script IS the page. */
export function readWatchPageChannel() {
  const link = document.querySelector<HTMLAnchorElement>("ytd-video-owner-renderer ytd-channel-name a");
  return link?.href ? { href: link.href, name: link.textContent ?? "" } : null;
}

/** The follow target for a YouTube channel link or channel page URL. `title`
 *  is the channel name as the caller knows it. Null when the URL is not a
 *  channel path. */
export function youtubeChannelTarget(href: string, title: string): CreatorTarget | null {
  const path = youtubeChannelPath(href);
  if (!path) return null;
  return { feedType: "youtube", feedUrl: `https://www.youtube.com/${path}`, kind: "youtuber", title };
}
