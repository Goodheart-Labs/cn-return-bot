/** Which Substack publication a page belongs to, as the follow button, the
 *  menu rows and the visit counts need it. How each kind of Substack address
 *  names its publication is described in @cn/core/substack. Nothing here uses
 *  the extension's browser API, so the site checks can run it too. The lookup
 *  for any post address is in substackPostCreator.ts. */
import { publicationInPreloads, substackFeedUrl, substackSubdomainOfUrl, type SubstackPublication } from "@cn/core/substack";
import { fetchWithRetries } from "@cn/core/retry";
import type { CreatorTarget } from "./creatorTarget";

export function substackTargetFromPublication(pub: SubstackPublication | null): CreatorTarget | null {
  return pub ? { feedType: "substack", feedUrl: substackFeedUrl(pub.subdomain), kind: "author", title: pub.name } : null;
}

/** The publication of a page on its own *.substack.com subdomain. Its title
 *  is the subdomain, because the address carries no name. */
export function substackCreatorTarget(pageUrl: string): CreatorTarget | null {
  const subdomain = substackSubdomainOfUrl(pageUrl);
  return subdomain ? substackTargetFromPublication({ subdomain, name: subdomain }) : null;
}

/** The text of the open page's preloads-json tag, which names the page's
 *  publication (publicationInPreloads in @cn/core/substack). The tag is
 *  visible to a content script even though the page's own JavaScript
 *  variables are not.
 *
 *  On substack.com itself the answer is always null. Those pages are the
 *  reader's own feed, inbox and profiles, so the data describes the reader
 *  rather than one creator. Its first subdomain can be the logged-in reader's
 *  own publication. It can also be a post opened earlier, because Substack
 *  switches pages there without reloading them. The popup used to offer that
 *  stranger's posts on the home page (GOO-394).
 *
 *  The popup and the site checks also run this inside the page, so it must
 *  stay self-contained: the serialized function has no imports over there. */
export function readSubstackPreloads(): string | null {
  if (/^(www\.)?substack\.com$/.test(location.hostname)) return null;
  return document.querySelector('script#preloads-json[type="application/json"]')?.textContent ?? null;
}

/** The open page's publication, or null when the page is not a Substack
 *  publication's own page. */
export const readSubstackPublicationFromPage = () => publicationInPreloads(readSubstackPreloads());

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
 *  the API knows their *.substack.com form. Null when the author has no
 *  publication or the API call failed. */
export async function resolveProfileCreatorTarget(handle: string): Promise<CreatorTarget | null> {
  try {
    const res = await fetchWithRetries(`https://substack.com/api/v1/user/${handle}/public_profile`, { credentials: "omit" });
    if (!res.ok) return null;
    const profile = await res.json();
    const publication = profile.primaryPublication ?? profile.publicationUsers?.[0]?.publication;
    const subdomain = publication?.subdomain;
    return subdomain ? substackTargetFromPublication({ subdomain, name: publication.name ?? subdomain }) : null;
  } catch {
    return null;
  }
}
