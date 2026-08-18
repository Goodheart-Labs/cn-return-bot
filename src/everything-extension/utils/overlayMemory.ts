import { browser } from "#imports";

// The request and follow overlays appear once per subject per person: the
// "we haven't checked this yet" card once per page, the follow offer once per
// feed. A later visit shows nothing; the context menu and the popup remain the
// ways to ask. The lists are rolling windows in local storage, so a subject
// can in principle resurface after hundreds of others, which is fine: the
// point is not to nag on every visit, not to keep a perfect ledger.
const SEEN_MAX = 500;
const SEEN_REQUEST_PAGES_KEY = "cn:seenRequestOverlayPages";
const SEEN_FOLLOW_FEEDS_KEY = "cn:seenFollowOverlayFeeds";

async function seenList(key: string): Promise<string[]> {
  return ((await browser.storage.local.get(key))[key] as string[] | undefined) ?? [];
}

async function markSeen(key: string, value: string): Promise<void> {
  const list = [...new Set([...(await seenList(key)), value])];
  await browser.storage.local.set({ [key]: list.slice(-SEEN_MAX) });
}

export const requestOverlaySeen = async (pageUrl: string) => (await seenList(SEEN_REQUEST_PAGES_KEY)).includes(pageUrl);
export const markRequestOverlaySeen = (pageUrl: string) => markSeen(SEEN_REQUEST_PAGES_KEY, pageUrl);
export const followOverlaySeen = async (feedUrl: string) => (await seenList(SEEN_FOLLOW_FEEDS_KEY)).includes(feedUrl);
export const markFollowOverlaySeen = (feedUrl: string) => markSeen(SEEN_FOLLOW_FEEDS_KEY, feedUrl);
