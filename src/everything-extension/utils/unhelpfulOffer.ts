import { browser } from "#imports";

// How many notes rated not helpful this reader has been shown in an opened
// note card. It decides when the "Don't show me unhelpful notes anymore" link
// appears. Local storage is enough: it is a nudge, not a setting.
const UNHELPFUL_SEEN_KEY = "cn:unhelpfulNotesSeen";

/** The link appears on the first unhelpful note a reader sees, and after that
 *  on every fifth one, so it is offered without nagging (GOO-241). */
const OFFER_EVERY_NTH_UNHELPFUL = 5;

/** Counts `shownCount` more unhelpful notes as seen and returns which of them,
 *  by position, should carry the link. Returns null when none should. */
export async function countUnhelpfulNotesSeen(shownCount: number): Promise<number | null> {
  const seenBefore = ((await browser.storage.local.get(UNHELPFUL_SEEN_KEY))[UNHELPFUL_SEEN_KEY] as number | undefined) ?? 0;
  await browser.storage.local.set({ [UNHELPFUL_SEEN_KEY]: seenBefore + shownCount });
  for (let index = 0; index < shownCount; index++) {
    if ((seenBefore + index) % OFFER_EVERY_NTH_UNHELPFUL === 0) return index;
  }
  return null;
}
