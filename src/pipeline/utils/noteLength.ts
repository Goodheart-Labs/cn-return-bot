/**
 * Note length helpers. X shortens URLs via t.co, so every URL counts as one
 * character toward the note limit.
 */

/** Count note length treating URLs as 1 character each. */
export function countNoteLength(note: string): number {
  return note.replace(/https?:\/\/\S+/g, "X").length;
}

/**
 * Builds the note exactly as it is submitted to X. That is the body followed by
 * its source URLs. `outcomeToResult` joins the sources with spaces into
 * `noteResult.url`, and the submitted text is `note + " " + url`, so this
 * function mirrors that. The writer's length budget has to count this whole
 * string and not the body alone. A body of 280 characters becomes 284 once two
 * sources are appended, because each URL counts as one character and each
 * separating space adds one more.
 */
export function joinNoteWithSources(noteBody: string, sources: string[]): string {
  return sources.length ? `${noteBody} ${sources.join(" ")}` : noteBody;
}

/** Counts the length of the note as it will actually be submitted, which is the
 *  body together with its sources. */
export function countSubmittedNoteLength(noteBody: string, sources: string[]): number {
  return countNoteLength(joinNoteWithSources(noteBody, sources));
}

/**
 * Builds the submitted note text from the fields a `noteResult` already holds.
 * There `note` is the body and `url` is the sources joined with spaces. This is
 * the counterpart of `joinNoteWithSources` for code that works with the shape
 * `outcomeToResult` produced, such as `processTweet`, rather than with the raw
 * sources array.
 */
export function joinNoteAndUrl(note: string, url: string): string {
  return url ? `${note} ${url}` : note;
}
