/** Every key under which server data sits in the query cache. A key is the
 *  address of one cached answer; queries sharing a prefix can be refreshed
 *  together, which is what the `noteSets` prefix is for. */
export const queryKeys = {
  /** The reader's own votes, on notes and on note-not-needed entries. */
  ownVotes: ["ownVotes"] as const,
  myVotes: (userId: string | undefined) => ["ownVotes", "notes", userId] as const,
  myNnnVotes: (userId: string | undefined) => ["ownVotes", "nnn", userId] as const,
  sourceDetails: (noteId: string) => ["sourceDetails", noteId] as const,
  /** Every cached NoteSet, whatever it is scoped to. */
  noteSets: ["noteSet"] as const,
  itemNoteSet: (itemId: string) => ["noteSet", "item", itemId] as const,
  /** The loaded pages of one notes feed on the website. The feed is named by
   *  its scope, its order and its filters. */
  noteFeed: (scope: unknown, order: string, filters: unknown) => ["noteSet", "feed", scope, order, filters] as const,
  /** The counts a notes feed shows besides its pages. */
  noteFeedSummary: (scope: unknown, filters: unknown, since: string[]) => ["noteFeedSummary", scope, filters, since] as const,
  /** How many visible notes a scope holds, without filters. */
  noteCount: (scope: unknown) => ["noteCount", scope] as const,
  /** A note a shared link points at, which its project page shows first. */
  sharedNote: (noteId: string) => ["noteSet", "shared", noteId] as const,
  /** The admins' curation of the best notes. Every section's pages and the
   *  whole leaderboard sit under one prefix, so a change reloads them all. */
  curation: ["noteSet", "curation"] as const,
  curationSection: (section: string, filters: unknown) => ["noteSet", "curation", "section", section, filters] as const,
  wholeLeaderboard: ["noteSet", "curation", "wholeLeaderboard"] as const,
  curationSummaries: ["curationSummary"] as const,
  curationSummary: (section: string) => ["curationSummary", section] as const,
  /** The pages of the projects overview in one order. */
  projectsPage: (order: string) => ["projects", order] as const,
  project: (slug: string) => ["project", slug] as const,
  /** The pages of one project's list of posts. */
  projectItems: (projectId: string) => ["projectItems", projectId] as const,
  feedItem: (itemId: string) => ["feedItem", itemId] as const,
  leaderboard: ["leaderboard"] as const,
  /** Everything the admins' note review page reads. */
  noteReview: ["noteReview"] as const,
  noteReviewSummary: ["noteReview", "summary"] as const,
  /** The pages of one sidebar section that the admin scrolled through. */
  noteReviewSection: (section: string) => ["noteReview", "section", section] as const,
  /** The newest page of a section, polled to notice new drafts. */
  noteReviewNewest: (section: string) => ["noteReview", "newest", section] as const,
  /** The live notes of the drafts on screen. They sit under the noteSet
   *  prefix, so a vote on one of them updates it here too. */
  noteReviewNoteSet: (noteIds: string[]) => ["noteSet", "noteReview", ...noteIds] as const,
  /** What the admins' dashboard reads: the metric series per bucket size,
   *  the walk's ranking of creators and the recently checked posts. */
  dashboardMetricSeries: (granularity: string) => ["dashboard", "metricSeries", granularity] as const,
  dashboardCreatorRanking: ["dashboard", "creatorRanking"] as const,
  dashboardRecentPosts: ["dashboard", "recentPosts"] as const,
  leaderboardOptIn: (userId: string | undefined) => ["leaderboardOptIn", userId] as const,
};

/** The keys mutations are filed under in the query client's mutation cache.
 *  Every vote, on a note or on a note-not-needed entry, is filed under `vote`,
 *  so the website can notice that a reader voted without being told by each
 *  vote button. */
export const mutationKeys = {
  vote: ["vote"] as const,
};
