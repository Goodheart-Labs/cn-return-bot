/** The one stand-in for ./db that every test file in this folder installs.
 *  bun's mock.module is global to the test process, and module evaluation can
 *  interleave across test files, so whichever registration is active when a
 *  module first loads serves that module for good. Two files installing
 *  different partial mocks therefore break each other depending on load
 *  order, which is exactly what happened in CI. Every file installs this same
 *  complete mock and steers its behaviour through `dbState`. */

import type { CreatorVisitScore } from "./db";

export const dbState = {
  /** What fetchItemUrlsIn / fetchItemUrlsContaining answer. */
  knownItems: [] as { id: string; url: string; checked_scope: "page" | "paragraph" | null }[],
  /** What findItemForPageUrl answers. */
  existingItem: null as { id: string; status: string; checked_scope: "page" | "paragraph" | null; first_checked_at: string | null } | null,
  /** What fetchDemandedPages answers, before the bars are applied. */
  demandedPages: [] as { page_url: string; feed_url: string | null; kind: "text" | "youtube"; readers: number }[],
  /** Makes recordDemandQueued fail, as when its table cannot be written. */
  recordDemandFails: false,
  /** What fetchRetryableErrorItems answers: failed posts due another attempt. */
  retryableErrors: [] as { id: string; url: string; title: string | null; published_at: string | null; retries: number; priority: number; feed_url: string | null }[],
  /** What fetchItemOutcomesSince answers: the last hour of reads. */
  itemOutcomes: [] as { source: string; outcome: "read" | "failed" | "skipped" }[],
  /** The addresses the demand rule queued before. */
  demandQueuedUrls: [] as string[],
  /** What fetchDemandReport answers. */
  demandReport: [] as { kind: "text" | "youtube"; queued_24h: number; settled: number; checked: number; with_notes: number }[],
  /** What fetchCreatorProjects answers: every creator we have a project for,
   *  whether or not their priority window is open. */
  creatorProjects: [] as {
    project_slug: string;
    feed_url: string;
    priority_until: string | null;
    top_posts_refreshed_at: string | null;
  }[],
  /** What fetchCreatorVisitScores answers: one row per creator. */
  creatorVisitScores: [] as CreatorVisitScore[],
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
  /** What fetchFeedPacing answers. The default is a fresh day with a known
   *  mean and no post started yet, so the next run is due at once. */
  feedPacing: {
    dbNow: new Date("2026-09-15T00:00:00Z"),
    spentTodayUsd: 0,
    meanPostCostUsd: 3 as number | null,
    samplePosts: 10,
    sampleHours: 48,
    lastFeedStartedAt: null as Date | null,
  },
  /** Every recorded call, keyed by function name. */
  calls: {} as Record<string, unknown[][]>,
};

export const resetDbState = () => {
  dbState.knownItems = [];
  dbState.existingItem = null;
  dbState.creatorProjects = [];
  dbState.demandedPages = [];
  dbState.demandReport = [];
  dbState.recordDemandFails = false;
  dbState.retryableErrors = [];
  dbState.itemOutcomes = [];
  dbState.demandQueuedUrls = [];
  dbState.creatorVisitScores = [];
  dbState.topPosts = [];
  dbState.feedPacing = {
    dbNow: new Date("2026-09-15T00:00:00Z"),
    spentTodayUsd: 0,
    meanPostCostUsd: 3,
    samplePosts: 10,
    sampleHours: 48,
    lastFeedStartedAt: null,
  };
  dbState.calls = {};
};

const record = (name: string) => (...args: unknown[]) => {
  (dbState.calls[name] ??= []).push(args);
  return Promise.resolve(
    name === "insertQueuedItem" ? "new-item-id" : name === "resolveProjectId" ? "project-id" : undefined,
  );
};

export const dbMock = () => ({
  QUEUE_PRIORITY: { requested: 2, prioritized: 1, backlog: 0 },
  fillProjectDisplayName: () => Promise.resolve(),
  fillProjectDisplayNameBySlug: () => Promise.resolve(),
  fetchItemUrlsIn: () => Promise.resolve(dbState.knownItems),
  fetchItemUrlsContaining: () => Promise.resolve(dbState.knownItems),
  fetchCreatorProjects: () => Promise.resolve(dbState.creatorProjects),
  fetchCreatorVisitScores: () => Promise.resolve(dbState.creatorVisitScores),
  fetchAllTopPosts: () => Promise.resolve(dbState.topPosts),
  fetchFeedPacing: () => Promise.resolve(dbState.feedPacing),
  fetchCostSinceUsd: () => Promise.resolve(0),
  fetchReaderCostSinceUsd: () => Promise.resolve(0),
  setFeedAlarm: record("setFeedAlarm"),
  replaceFeedTopPosts: record("replaceFeedTopPosts"),
  stampTopPostsAttempt: record("stampTopPostsAttempt"),
  fetchYoutubeChannel: () => Promise.resolve(null),
  saveYoutubeChannel: record("saveYoutubeChannel"),
  countYoutubeNotifications: () => Promise.resolve({ notified: 0, subscribed: 0 }),
  upsertCreatorPriority: record("upsertCreatorPriority"),
  fetchItemClaims: () => Promise.resolve([]),
  fetchOrphanedProcessingItems: (_tier: "requested" | "feed") => Promise.resolve([]),
  fetchRetryableErrorItems: () => Promise.resolve(dbState.retryableErrors),
  fetchItemOutcomesSince: () => Promise.resolve(dbState.itemOutcomes),
  fetchDemandQueuedUrls: (urls: string[]) => Promise.resolve(new Set(urls.filter((u) => dbState.demandQueuedUrls.includes(u)))),
  requeueErroredItem: record("requeueErroredItem"),
  fetchPendingNoteRequests: () => Promise.resolve([]),
  fetchQueueOverview: () => Promise.resolve([]),
  enqueueItems: () => Promise.resolve(0),
  markItemError: () => Promise.resolve(),
  findItemForPageUrl: () => Promise.resolve(dbState.existingItem),
  promoteItemToWholePage: record("promoteItemToWholePage"),
  raiseItemPriority: record("raiseItemPriority"),
  requeueItem: record("requeueItem"),
  resolveNoteRequest: record("resolveNoteRequest"),
  insertQueuedItem: record("insertQueuedItem"),
  insertItemRun: record("insertItemRun"),
  insertClaimPipelineRun: record("insertClaimPipelineRun"),
  insertClaims: () => Promise.resolve(["requested-claim"]),
  insertNote: record("insertNote"),
  setClaimStatus: record("setClaimStatus"),
  resolveProjectId: record("resolveProjectId"),
  // Applies the bars as the database function does: a null bar leaves the kind out.
  fetchDemandedPages: (textReaders: number | null, youtubeReaders: number | null) =>
    Promise.resolve(
      dbState.demandedPages.filter((p) => {
        const bar = p.kind === "text" ? textReaders : youtubeReaders;
        return bar !== null && p.readers >= bar;
      }),
    ),
  fetchDemandReport: () => Promise.resolve(dbState.demandReport),
  recordDemandQueued: (...args: unknown[]) =>
    dbState.recordDemandFails ? Promise.reject(new Error("log is down")) : record("recordDemandQueued")(...args),
  insertFollowedFeed: record("insertFollowedFeed"),
  resolveFollowRequest: record("resolveFollowRequest"),
});
