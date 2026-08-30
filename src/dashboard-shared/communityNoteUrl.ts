// This is the only place that builds the public permalink of a Community Note.
export const communityNoteUrl = (noteId: string) =>
  `https://x.com/i/communitynotes/n/${noteId}`;
