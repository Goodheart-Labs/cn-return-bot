/* The background sync of the covered-pages lists, and why it is not a full
 * download every five minutes. Each sync used to page through every item and
 * every note (about 2 MB on 2026-11-08, growing with the data), on every open
 * browser, every five minutes. That was most of the project's Supabase egress,
 * which passed its quota on 2026-11-08. Now the whole lists are fetched at most
 * once an hour, and the five-minute tick asks only for pages ingested since the
 * last sync, which is what lets a newly checked page show its notes within
 * minutes. Note counts and the checked list refresh hourly. */

export const FULL_SYNC_EVERY_MS = 60 * 60_000;
/** A delta reaches back this far before the last sync, so a client clock a
 *  little off from the database's, or a row committed late, is still caught.
 *  Merging is a union, so the overlap costs nothing but a few repeated URLs. */
export const DELTA_OVERLAP_MS = 15 * 60_000;

export interface SyncState {
  /** When the last full sync started, in client milliseconds. */
  fullAt: number;
  /** When the last sync of either kind started. */
  lastAt: number;
}

export type SyncPlan = { kind: "full" } | { kind: "delta"; since: string };

export function planSync(state: SyncState | null, hasCachedList: boolean, now: number): SyncPlan {
  if (!state || !hasCachedList) return { kind: "full" };
  // A clock moved backwards leaves times in the future; trust nothing then.
  if (state.fullAt > now || state.lastAt > now) return { kind: "full" };
  if (now - state.fullAt >= FULL_SYNC_EVERY_MS) return { kind: "full" };
  return { kind: "delta", since: new Date(state.lastAt - DELTA_OVERLAP_MS).toISOString() };
}

export function parseSyncState(stored: unknown): SyncState | null {
  const s = stored as Partial<SyncState> | null | undefined;
  return s && typeof s.fullAt === "number" && typeof s.lastAt === "number" ? { fullAt: s.fullAt, lastAt: s.lastAt } : null;
}

/** The cached list with the delta's new URLs added, or null when none is new. */
export function mergeCoveredUrls(cached: string[], added: string[]): string[] | null {
  const have = new Set(cached);
  const fresh = [...new Set(added)].filter((url) => !have.has(url));
  return fresh.length ? [...cached, ...fresh] : null;
}
