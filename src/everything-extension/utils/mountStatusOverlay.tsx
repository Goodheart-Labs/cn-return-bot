import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { requestCreatorPriority } from "../../everything-shared/noteRequests";
import { StatusOverlay, type StatusAction } from "../components/StatusOverlay";
import type { NoteCounts } from "./claimGroups";
import { priorityButtonLabel, priorityDoneLabel, type CreatorTarget } from "./creatorTarget";
import { rememberPressed } from "./prioritizedCreators";
import { isPageDark } from "./pageTheme";

export interface StatusOverlayParams {
  noun: "post" | "video" | "page";
  /** The note counts of the page's item (utils/claimGroups.ts). Null means we
   *  have not checked the page; only the popup renders that sentence, because
   *  the in-page card is mounted with counts alone. */
  counts: NoteCounts | null;
  /** Whether the pipeline has read this page in full
   *  (everything-shared/notesQuery.ts isWholePageChecked). */
  wholePageChecked: boolean;
  /** Jumps to the next note when the reader clicks the count headline. Shares
   *  the popup jump button's cursor (utils/jumpBus.ts). Only used when the
   *  card actually has notes to jump to. */
  onOpenNotes?: () => void;
}

/* The status sentences carry no trailing dot. They stand alone on a card or
 * as the popup's link, where a period reads as clutter. */
export function headline(params: Pick<StatusOverlayParams, "noun" | "counts" | "wholePageChecked">): string {
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

interface CardProps {
  headline: string;
  onHeadlineClick?: () => void;
}

/** The mounted card's handle: tear it down, or re-render it with fresh props.
 *  Re-rendering keeps the component's own state, so the hide timer is not
 *  reset by an update. */
interface MountedCard {
  teardown: () => void;
  update: (next: Partial<CardProps>) => void;
}

async function mountCard(ctx: ContentScriptContext, props: CardProps): Promise<MountedCard> {
  let root: Root | null = null;
  let current = props;
  const render = () => root?.render(<StatusOverlay headline={current.headline} onHeadlineClick={current.onHeadlineClick} />);
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-status",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      render();
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return {
    teardown: () => ui.remove(),
    update: (next) => {
      current = { ...current, ...next };
      render();
    },
  };
}

/** Mounts the transient note-count card in its own shadow root. */
export interface StatusOverlayHandle {
  teardown: () => void;
  /** Re-renders the card's headline from fresh counts, so a note posted while
   *  the card still stands does not leave a stale sentence on screen. */
  updateCounts: (counts: NoteCounts) => void;
}

export async function mountStatusOverlay(ctx: ContentScriptContext, params: StatusOverlayParams): Promise<StatusOverlayHandle> {
  const card = await mountCard(ctx, {
    headline: headline(params),
    // The numbers ignore the filters, but a jump can only reach rendered
    // notes, so the headline is a button only while something renders.
    onHeadlineClick: params.counts && params.counts.visible > 0 ? params.onOpenNotes : undefined,
  });
  return {
    teardown: card.teardown,
    updateCounts: (counts) =>
      card.update({
        headline: headline({ ...params, counts }),
        onHeadlineClick: counts.visible > 0 ? params.onOpenNotes : undefined,
      }),
  };
}

/** Mounts a headline-only card, used to explain why a request was not needed.
 *  The card hides itself like every status card; the teardown removes it. */
export async function mountInfoOverlay(ctx: ContentScriptContext, headline: string): Promise<() => void> {
  return (await mountCard(ctx, { headline })).teardown;
}
