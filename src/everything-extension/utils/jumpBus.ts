// The note-count card and the popup both step through a page's notes with the
// same cursor. The popup reaches the notes UI through a tab message, but the
// card cannot: it renders in its own React tree, in its own shadow root, next
// to the notes UI. Both trees run in the same content script, so a
// module-level slot is all that is needed to connect them. The notes UI
// registers its jump function here, and the card calls it.
let handler: (() => void) | null = null;

/** Registers the jump function, or null to unregister on unmount. */
export function setJumpHandler(fn: (() => void) | null): void {
  handler = fn;
}

/** Jumps to the next note, exactly as the popup's jump button would. Does
 *  nothing while the notes UI has not mounted yet. */
export function jumpToNextNote(): void {
  handler?.();
}
