/** The one stand-in for ./db that every test file in this folder installs.
 *  bun's mock.module is global to the test process, and module evaluation can
 *  interleave across test files, so whichever registration is active when a
 *  module first loads serves that module for good. Two files installing
 *  different partial mocks therefore break each other depending on load
 *  order, which is exactly what happened in CI. Every file installs this same
 *  complete mock and steers its behaviour through `dbState`. */

export const dbState = {
  /** What fetchItemUrlsIn / fetchItemUrlsContaining answer. */
  knownItems: [] as { id: string; url: string; checked_scope: "page" | "paragraph" | null }[],
  /** What findItemForPageUrl answers. */
  existingItem: null as { id: string; status: string; checked_scope: "page" | "paragraph" | null } | null,
  /** What fetchFollowedFeeds answers. */
  followedFeeds: [] as {
    project_slug: string;
    feed_type: "substack" | "youtube";
    feed_url: string;
    priority: number;
    priority_until: string | null;
    top_posts_refreshed_at?: string | null;
  }[],
  /** What fetchVisitCounts answers. */
  visitCounts: [] as { feed_url: string; visits: number }[],
  /** What fetchAllTopPosts answers. */
  topPosts: [] as {
    feed_url: string;
    source: "substack" | "youtube";
    url: string;
    title: string | null;
    published_at: string | null;
    popularity: number;
    rank: number;
  }[],
  /** Every recorded call, keyed by function name. */
  calls: {} as Record<string, unknown[][]>,
};

export const resetDbState = () => {
  dbState.knownItems = [];
  dbState.existingItem = null;
  dbState.followedFeeds = [];
  dbState.visitCounts = [];
  dbState.topPosts = [];
  dbState.calls = {};
};

const record = (name: string) => (...args: unknown[]) => {
  (dbState.calls[name] ??= []).push(args);
  return Promise.resolve(
    name === "insertQueuedItem" ? "new-item-id" : name === "resolveProjectId" ? "project-id" : undefined,
  );
};

export const dbMock = () => ({
  QUEUE_PRIORITY: { requested: 2, followed: 1, backlog: 0, retry: -1 },
  fillProjectDisplayName: () => Promise.resolve(),
  fillProjectDisplayNameBySlug: () => Promise.resolve(),
  fetchItemUrlsIn: () => Promise.resolve(dbState.knownItems),
  fetchItemUrlsContaining: () => Promise.resolve(dbState.knownItems),
  fetchFollowedFeeds: () => Promise.resolve(dbState.followedFeeds),
  fetchVisitCounts: () => Promise.resolve(dbState.visitCounts),
  fetchAllTopPosts: () => Promise.resolve(dbState.topPosts),
  replaceFeedTopPosts: record("replaceFeedTopPosts"),
  upsertFeedPriority: record("upsertFeedPriority"),
  fetchItemClaims: () => Promise.resolve([]),
  fetchOrphanedProcessingItems: () => Promise.resolve([]),
  fetchRetryableErrorItems: () => Promise.resolve([]),
  requeueErroredItem: record("requeueErroredItem"),
  fetchPendingNoteRequests: () => Promise.resolve([]),
  fetchPendingFollowRequests: () => Promise.resolve([]),
  enqueueItems: () => Promise.resolve(0),
  markItemError: () => Promise.resolve(),
  findItemForPageUrl: () => Promise.resolve(dbState.existingItem),
  promoteItemToWholePage: record("promoteItemToWholePage"),
  raiseItemPriority: record("raiseItemPriority"),
  requeueItem: record("requeueItem"),
  resolveNoteRequest: record("resolveNoteRequest"),
  insertQueuedItem: record("insertQueuedItem"),
  resolveProjectId: record("resolveProjectId"),
  insertFollowedFeed: record("insertFollowedFeed"),
  resolveFollowRequest: record("resolveFollowRequest"),
});
