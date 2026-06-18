/**
 * Note length helpers. X shortens URLs via t.co, so every URL counts as one
 * character toward the note limit.
 */

/** Count note length treating URLs as 1 character each. */
export function countNoteLength(note: string): number {
  return note.replace(/https?:\/\/\S+/g, "X").length;
}

/**
 * The note exactly as submitted to X: the body followed by its source URLs.
 * `outcomeToResult` joins sources with spaces into `noteResult.url`, and the
 * submitted text is `note + " " + url`, so this mirrors that. The writer's
 * length budget must count THIS, not the body alone — a 280-char body becomes
 * 284 once two sources are appended (each URL counts as 1 char).
 */
export function joinNoteWithSources(noteBody: string, sources: string[]): string {
  return sources.length ? `${noteBody} ${sources.join(" ")}` : noteBody;
}

/** countNoteLength of the note as it will actually be submitted (body + sources). */
export function countSubmittedNoteLength(noteBody: string, sources: string[]): number {
  return countNoteLength(joinNoteWithSources(noteBody, sources));
}

/**
 * The submitted note text from a `noteResult`'s pre-joined fields: `note` is the
 * body and `url` is already `sources.join(" ")`. The `joinNoteWithSources`
 * counterpart for code that holds the post-`outcomeToResult` shape (processTweet)
 * rather than the raw sources array.
 */
export function joinNoteAndUrl(note: string, url: string): string {
  return url ? `${note} ${url}` : note;
}
