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
  projectNoteSet: (projectId: string) => ["noteSet", "project", projectId] as const,
  itemNoteSet: (itemId: string) => ["noteSet", "item", itemId] as const,
  /** Every visible note on the site, for the website's All notes page. */
  allNoteSet: ["noteSet", "all"] as const,
  /** The notes on the best notes list, for the website's Best notes page. */
  bestNoteSet: ["noteSet", "best"] as const,
  /** The best notes list itself: which notes, in which order. */
  bestNotes: ["bestNotes"] as const,
  /** The posts the best notes are on. */
  bestNoteItems: ["bestNoteItems"] as const,
  projects: ["projects"] as const,
  projectItems: (projectId: string) => ["projectItems", projectId] as const,
  itemsWithNotes: ["itemsWithNotes"] as const,
  /** How many devices outside the team saw each item's notes. */
  itemNoteViewers: ["itemNoteViewers"] as const,
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
  leaderboardOptIn: (userId: string | undefined) => ["leaderboardOptIn", userId] as const,
};

/** The keys mutations are filed under in the query client's mutation cache.
 *  Every vote, on a note or on a note-not-needed entry, is filed under `vote`,
 *  so the website can notice that a reader voted without being told by each
 *  vote button. */
export const mutationKeys = {
  vote: ["vote"] as const,
};
