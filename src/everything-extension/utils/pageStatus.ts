import { requestCreatorPriority } from "@cn/core/creators";
import type { StatusAction } from "../components/ActionButton";
import type { NoteCounts } from "./claimGroups";
import { priorityButtonLabel, priorityDoneLabel, type CreatorTarget } from "./creatorTarget";
import { rememberPressed } from "./prioritizedCreators";

export interface PageStatus {
  noun: "post" | "video" | "page";
  /** The note counts of the page's item (utils/claimGroups.ts). Null means we
   *  have not checked the page. */
  counts: NoteCounts | null;
  /** Whether the pipeline has read this page in full
   *  (everything-core/items.ts isWholePageChecked). */
  wholePageChecked: boolean;
}

/* The popup's status sentence. It carries no trailing dot, because it stands
 * alone as the popup's link, where a period reads as clutter. */
export function headline(params: PageStatus): string {
  const { counts, noun, wholePageChecked } = params;
  if (!counts) return `We haven't checked this ${noun} yet`;
  const { helpful, needsRatings, notHelpful } = counts;
  if (helpful === 0 && needsRatings === 0) {
    // The sentence "found nothing to note" is only true for a page that was
    // read in full and genuinely produced nothing. A page that only carries a
    // reader's note, or a checked paragraph, has not been read whole; a page
    // whose notes were all rated not helpful found plenty.
    if (notHelpful > 0) return `No note on this ${noun} is currently rated helpful`;
    if (wholePageChecked) return `We checked this ${noun} and found nothing to note`;
    return `We haven't checked this whole ${noun} yet`;
  }
  const surface = noun === "video" ? "video" : "page";
  const notes = (n: number) => (n === 1 ? "1 Common Note" : `${n} Common Notes`);
  if (helpful === 0) {
    return `${notes(needsRatings)} on this ${surface} ${needsRatings === 1 ? "needs" : "need"} more ratings`;
  }
  const ratings =
    needsRatings === 0 ? "" : needsRatings === 1 ? ", 1 needs more ratings" : `, ${needsRatings} need more ratings`;
  return `${notes(helpful)} on this ${surface}${ratings}`;
}

/** The press that gives a creator a week of checking. The button is only built
 *  for a creator whose window is closed (see unlessPrioritized), so it always
 *  starts offering the press rather than a confirmation. On success the creator
 *  is added to the cached list straight away, so the button shows its done
 *  state without waiting for the next sync. */
export async function buildPriorityAction(target: CreatorTarget): Promise<StatusAction> {
  return {
    label: priorityButtonLabel(target),
    doneLabel: priorityDoneLabel(target),
    alreadyDone: false,
    run: async () => {
      await requestCreatorPriority({ feedUrl: target.feedUrl });
      await rememberPressed(target).catch(() => {});
    },
  };
}
