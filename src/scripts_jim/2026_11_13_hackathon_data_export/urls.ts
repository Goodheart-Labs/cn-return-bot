/** Query parameters that only record who shared a link or how it was reached.
 *  Some name the person who shared it (Substack's `r`), and some unlock a paid
 *  article for whoever holds the link (`unlocked_article_code`). */
const TRACKING_PARAMS = new Set([
  "r", "ref", "ref_src", "ref_url", "smid", "mod", "unlocked_article_code", "gift", "giftCopy", "share", "sharetoken",
  "isFreemail", "publication_id", "post_id", "triedRedirect", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "si",
  "token", "access_token", "sk",
]);

export function stripTrackingParams(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}
