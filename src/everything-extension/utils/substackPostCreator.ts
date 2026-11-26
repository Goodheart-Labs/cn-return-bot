import { browser } from "#imports";
import { fetchPagePublication, substackReaderPostId, type SubstackPublication } from "@cn/core/substack";
import type { CreatorTarget } from "./creatorTarget";
import { readerCanonical } from "./readerCanonical";
import { storedCache } from "./storedCache";
import { readSubstackPublicationFromPage, substackCreatorTarget, substackTargetFromPublication } from "./substackCreator";

export const SUBSTACK_CREATOR_MESSAGE_TYPE = "cn-substack-creator";

const CUSTOM_DOMAIN_PUBLICATIONS_KEY = "cn:customDomainPublications";
const CUSTOM_DOMAIN_PUBLICATIONS_MAX = 2000;

/** Which publication each custom domain belongs to. This never changes, so
 *  it is read out of one of the domain's pages once and kept. */
const customDomainPublications = storedCache<SubstackPublication>(CUSTOM_DOMAIN_PUBLICATIONS_KEY, CUSTOM_DOMAIN_PUBLICATIONS_MAX);

/** The publication of a Substack post, from any of its addresses: a reader
 *  link on substack.com, a post on a *.substack.com subdomain, or a post on a
 *  custom domain. Only the background and the popup may call it, because its
 *  fetches must be free of CORS. */
export async function fetchSubstackPostCreator(postUrl: string): Promise<CreatorTarget | null> {
  const ownUrl = (await readerCanonical(postUrl)) ?? postUrl;
  const own = substackCreatorTarget(ownUrl);
  if (own) return own;
  // A reader link that could not be resolved names no publication, and its
  // substack.com page describes no creator.
  if (substackReaderPostId(ownUrl)) return null;
  const { hostname } = new URL(ownUrl);
  return substackTargetFromPublication(await customDomainPublications.remember(hostname, () => fetchPagePublication(ownUrl)));
}

/** The same for content scripts. A post on the open page's own domain is read
 *  from the page, and any other post is asked of the background. */
export async function substackPostCreator(postUrl: string): Promise<CreatorTarget | null> {
  const own = substackCreatorTarget(postUrl);
  if (own) return own;
  const onThisPage = new URL(postUrl).hostname === location.hostname && !substackReaderPostId(postUrl);
  if (onThisPage) return substackTargetFromPublication(readSubstackPublicationFromPage());
  return (await browser.runtime.sendMessage({ type: SUBSTACK_CREATOR_MESSAGE_TYPE, postUrl }).catch(() => null)) ?? null;
}
