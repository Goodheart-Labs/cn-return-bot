
/** Works out which creator the current page belongs to, so a reader can ask us
 *  to check their new posts. Whether that creator is already prioritised is a
 *  separate question, answered by unlessPrioritized in prioritizedCreators.ts
 *  against the synced list. */

export interface CreatorTarget {
  feedType: "substack" | "youtube";
  /** The feed in the form the pipeline stores: the *.substack.com publication
   *  root, or the YouTube channel URL. */
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
export function substackTargetFromPublication(pub: { subdomain: string; name: string } | null): CreatorTarget | null {
  if (!pub) return null;
  return { feedType: "substack", feedUrl: `https://${pub.subdomain}.substack.com`, kind: "author", title: pub.name };
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

/** The follow target for a YouTube channel link or channel page URL. `title`
 *  is the channel name as the caller knows it. Null when the URL is not a
 *  channel path. */
export function youtubeChannelTarget(href: string, title: string): CreatorTarget | null {
  const path = youtubeChannelPath(href);
  if (!path) return null;
  return { feedType: "youtube", feedUrl: `https://www.youtube.com/${path}`, kind: "youtuber", title };
}
