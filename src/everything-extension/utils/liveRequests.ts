import { browser } from "#imports";

/** The note requests this device is still watching, keyed by page URL. This is
 *  what lets the progress card come back after a navigation: everything shown
 *  is derived from database rows, and this record holds the token that finds
 *  them. Entries are removed by the watcher once the request reaches a
 *  terminal state, and pruned by age as a backstop for entries whose end we
 *  never saw. */
const LIVE_REQUESTS_KEY = "cn:liveRequests";

/** A request older than this is no longer worth restoring a spinner for. The
 *  pipeline either finished it long ago or it fell through the cracks; either
 *  way the page's notes, if any, speak for themselves by then. */
const LIVE_REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface LiveRequest {
  pageUrl: string;
  /** The client token submitNoteRequest generated and stored on the request
   *  row. Exchanged for the request's status via everything_request_status. */
  token: string;
  /** The item the request became, once the status lookup revealed it. Stored
   *  so a revisit skips the lookup phase and watches the item directly. */
  itemId?: string;
  requestedAt: number;
}

async function readFresh(): Promise<Record<string, LiveRequest>> {
  const stored = (await browser.storage.local.get(LIVE_REQUESTS_KEY))[LIVE_REQUESTS_KEY] as
    | Record<string, LiveRequest>
    | undefined;
  const now = Date.now();
  const fresh: Record<string, LiveRequest> = {};
  for (const [url, entry] of Object.entries(stored ?? {})) {
    if (now - entry.requestedAt < LIVE_REQUEST_MAX_AGE_MS) fresh[url] = entry;
  }
  return fresh;
}

export async function saveLiveRequest(entry: LiveRequest): Promise<void> {
  const entries = await readFresh();
  entries[entry.pageUrl] = entry;
  await browser.storage.local.set({ [LIVE_REQUESTS_KEY]: entries });
}

export async function getLiveRequest(pageUrl: string): Promise<LiveRequest | null> {
  return (await readFresh())[pageUrl] ?? null;
}

export async function removeLiveRequest(pageUrl: string): Promise<void> {
  const entries = await readFresh();
  delete entries[pageUrl];
  await browser.storage.local.set({ [LIVE_REQUESTS_KEY]: entries });
}
