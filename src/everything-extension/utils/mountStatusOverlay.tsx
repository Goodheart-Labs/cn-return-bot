import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { submitFollowRequest, submitNoteRequest } from "../../everything-shared/noteRequests";
import { StatusOverlay, type StatusAction } from "../components/StatusOverlay";
import { readPageForRequest } from "./pageCapture";
import type { NoteCounts } from "./claimGroups";
import { followButtonLabel, followDoneLabel, type FollowTarget } from "./followTarget";
import { followOverlaySeen, markFollowOverlaySeen, markRequestOverlaySeen, requestOverlaySeen } from "./overlayMemory";
import { isPageDark } from "./pageTheme";
import { addRequestedFollow, addRequestedPage, getRequestedFollows, getRequestedPages, getSettings } from "./settings";

export interface StatusOverlayParams {
  pageUrl: string;
  noun: "post" | "video" | "page";
  /** Null while the page has no item at all, otherwise the note counts
   *  (utils/claimGroups.ts). */
  counts: NoteCounts | null;
  /** Whether the pipeline has read this page in full
   *  (everything-shared/notesQuery.ts isWholePageChecked). A page with an
   *  item that is not fully checked, because a reader wrote a note on it or
   *  one paragraph was checked, still offers the request. */
  wholePageChecked: boolean;
  /** Jumps to the next note when the reader clicks the count headline. Shares
   *  the popup jump button's cursor (utils/jumpBus.ts). Only used when the
   *  card actually has notes to jump to. */
  onOpenNotes?: () => void;
  /** The author's feed, when the page has one we could follow. Null also when
   *  the feed is already on the synced followed list; the caller decides. */
  followTarget: FollowTarget | null;
  /** Whether a request should carry the page's body text. On it stays for text
   *  pages, off for YouTube, where the pipeline fetches the transcript itself
   *  and the page text is player chrome. */
  requestWithPageText: boolean;
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

/** The follow action for a target, or null when the user already asked. The
 *  ask is remembered on the device, so surfaces show the confirmation instead
 *  of offering the button again. */
export async function buildFollowAction(target: FollowTarget): Promise<StatusAction> {
  return {
    label: followButtonLabel(target),
    doneLabel: followDoneLabel(target),
    alreadyDone: (await getRequestedFollows()).includes(target.feedUrl),
    run: async () => {
      await submitFollowRequest({ feedType: target.feedType, feedUrl: target.feedUrl, title: target.title });
      await addRequestedFollow(target.feedUrl).catch(() => {});
    },
  };
}

async function buildActions(params: StatusOverlayParams): Promise<{ request: StatusAction | null; follow: StatusAction | null }> {
  // Only a page the pipeline has read in full stops offering the request. A
  // page whose item exists for another reason still offers it, with wording
  // that says what the click will do.
  if (params.wholePageChecked) return { request: null, follow: null };
  // On the note-count card the request button obeys the same setting as the
  // request card, which is off by default. The popup and the context menus
  // stay the always-available route. The no-item card is gated at its call
  // site, so this only concerns a page that already has an item.
  if (params.counts && !(await getSettings()).showRequestOverlay) return { request: null, follow: null };
  const request: StatusAction = {
    label: params.counts ? "Check this whole page" : "Request Common Notes",
    doneLabel: params.counts
      ? "Requested. We'll check the whole page when it comes up in our queue."
      : "Requested. We'll check this page when it comes up in our queue.",
    alreadyDone: (await getRequestedPages()).includes(params.pageUrl),
    run: async () => {
      await submitNoteRequest({
        pageUrl: params.pageUrl,
        pageTitle: document.title,
        selection: null,
        pageText: params.requestWithPageText ? readPageForRequest().text : null,
      });
      // This is only a local reminder. The request itself is already saved.
      await addRequestedPage(params.pageUrl).catch(() => {});
    },
  };
  const follow =
    params.followTarget && (await getSettings()).showFollowOverlay ? await buildFollowAction(params.followTarget) : null;
  return { request, follow };
}

interface CardProps {
  headline: string | null;
  onHeadlineClick?: () => void;
  request: StatusAction | null;
  follow: StatusAction | null;
  onDisplayed?: () => void;
}

/** The mounted card's handle: tear it down, or re-render it with fresh props.
 *  Re-rendering keeps the component's own state, so the hide timers and a
 *  running request are not reset by an update. */
interface MountedCard {
  teardown: () => void;
  update: (next: Partial<CardProps>) => void;
}

async function mountCard(ctx: ContentScriptContext, props: CardProps): Promise<MountedCard> {
  let root: Root | null = null;
  let current = props;
  const render = () =>
    root?.render(
      <StatusOverlay
        headline={current.headline}
        onHeadlineClick={current.onHeadlineClick}
        request={current.request}
        follow={current.follow}
        onDisplayed={current.onDisplayed}
      />,
    );
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

/** Mounts the transient "have we checked this yet" card in its own shadow root
 *  and returns a teardown function. The request-offer variant appears once per
 *  page; a later visit falls back to the follow-only card, which keeps its own
 *  once-per-feed memory. The note-count card is not rationed. */
export interface StatusOverlayHandle {
  teardown: () => void;
  /** Re-renders the card's headline from fresh counts, so a note posted while
   *  the card still stands does not leave a stale sentence on screen. */
  updateCounts: (counts: NoteCounts) => void;
}

export async function mountStatusOverlay(ctx: ContentScriptContext, params: StatusOverlayParams): Promise<StatusOverlayHandle> {
  const offersRequest = !params.wholePageChecked;
  if (offersRequest && !params.counts && (await requestOverlaySeen(params.pageUrl))) {
    const teardown = params.followTarget ? await mountFollowOverlay(ctx, params.followTarget) : () => {};
    return { teardown, updateCounts: () => {} };
  }
  const { request, follow } = await buildActions(params);
  // The showing is spent only once the card actually stood on screen. Marking
  // at mount burned the one showing in a background tab, or while the reader
  // was still reading the article, and the offer never came back.
  const onDisplayed =
    offersRequest && !params.counts
      ? async () => {
          await markRequestOverlaySeen(params.pageUrl);
          // Only a follow button that actually rendered counts as seen, so
          // turning follow overlays on later still gets its one showing.
          if (follow && params.followTarget) await markFollowOverlaySeen(params.followTarget.feedUrl);
        }
      : undefined;
  const card = await mountCard(ctx, {
    headline: headline(params),
    // The numbers ignore the filters, but a jump can only reach rendered
    // notes, so the headline is a button only while something renders.
    onHeadlineClick: params.counts && params.counts.visible > 0 ? params.onOpenNotes : undefined,
    request,
    follow,
    onDisplayed,
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

/** Mounts the follow-only card shown on an author's own pages: a publication
 *  homepage, a Substack profile, or a YouTube channel. The card is only the
 *  button, and it is not mounted at all when the user already asked, turned
 *  follow overlays off, or was already offered this feed once. Returns a
 *  teardown function either way. */
export async function mountFollowOverlay(ctx: ContentScriptContext, target: FollowTarget): Promise<() => void> {
  if (!(await getSettings()).showFollowOverlay) return () => {};
  if (await followOverlaySeen(target.feedUrl)) return () => {};
  const follow = await buildFollowAction(target);
  if (follow.alreadyDone) return () => {};
  const card = await mountCard(ctx, {
    headline: null,
    request: null,
    follow,
    onDisplayed: () => void markFollowOverlaySeen(target.feedUrl),
  });
  return card.teardown;
}

/** Mounts a headline-only card, used to explain why a request was not needed.
 *  The card hides itself like every status card; the teardown removes it. */
export async function mountInfoOverlay(ctx: ContentScriptContext, headline: string): Promise<() => void> {
  return (await mountCard(ctx, { headline, request: null, follow: null })).teardown;
}
