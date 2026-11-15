/** Whether every noted passage on the page is still below the window, so the
 *  reader has not reached any note yet. Most readers stop before the notes:
 *  passages in the first ~1k words are seen by about 41% of the readers who load
 *  the page, those further down by 2–24%. While this holds, a pill at the bottom
 *  of the window says how many notes the page has and jumps to the first. Once a
 *  passage is on screen or above it, the reader has reached the notes. */
export function notesAllAhead(passages: readonly { top: number; bottom: number }[], viewportHeight: number): boolean {
  return passages.length > 0 && passages.every((p) => p.top >= viewportHeight);
}
