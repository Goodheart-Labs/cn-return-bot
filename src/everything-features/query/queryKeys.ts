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
  projects: ["projects"] as const,
  projectItems: (projectId: string) => ["projectItems", projectId] as const,
  leaderboard: ["leaderboard"] as const,
  leaderboardOptIn: (userId: string | undefined) => ["leaderboardOptIn", userId] as const,
};
