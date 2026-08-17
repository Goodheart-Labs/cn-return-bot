import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { submitFollowRequest, submitNoteRequest } from "../../everything-shared/noteRequests";
import { StatusOverlay, type StatusAction } from "../components/StatusOverlay";
import { readPageForRequest } from "./pageCapture";
import { followButtonLabel, followDoneLabel, type FollowTarget } from "./followTarget";
import { isPageDark } from "./pageTheme";
import { addRequestedFollow, addRequestedPage, getRequestedFollows, getRequestedPages } from "./settings";

export interface StatusOverlayParams {
  pageUrl: string;
  noun: "post" | "video" | "page";
  /** Null while the page has not been checked, otherwise its note count. */
  checked: { noteCount: number } | null;
  /** The author's feed, when the page has one we could follow. Null also when
   *  the feed is already on the synced followed list; the caller decides. */
  followTarget: FollowTarget | null;
  /** Whether a request should carry the page's body text. On it stays for text
   *  pages, off for YouTube, where the pipeline fetches the transcript itself
   *  and the page text is player chrome. */
  requestWithPageText: boolean;
}

function headline(params: StatusOverlayParams): string {
  if (!params.checked) return `We haven't checked this ${params.noun} yet.`;
  const { noteCount } = params.checked;
  if (noteCount === 0) return `We checked this ${params.noun} and found nothing to note.`;
  const surface = params.noun === "video" ? "video" : "page";
  return noteCount === 1 ? `1 Common Note on this ${surface}.` : `${noteCount} Common Notes on this ${surface}.`;
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
  if (params.checked) return { request: null, follow: null };
  const request: StatusAction = {
    label: "Request Common Notes",
    doneLabel: "Requested. We'll check this page when it comes up in our queue.",
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
  const follow = params.followTarget ? await buildFollowAction(params.followTarget) : null;
  return { request, follow };
}

async function mountCard(
  ctx: ContentScriptContext,
  props: { headline: string | null; request: StatusAction | null; follow: StatusAction | null },
): Promise<() => void> {
  let root: Root | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-status",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      root.render(<StatusOverlay headline={props.headline} request={props.request} follow={props.follow} />);
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}

/** Mounts the transient "have we checked this yet" card in its own shadow root
 *  and returns a teardown function. */
export async function mountStatusOverlay(ctx: ContentScriptContext, params: StatusOverlayParams): Promise<() => void> {
  const { request, follow } = await buildActions(params);
  return mountCard(ctx, { headline: headline(params), request, follow });
}

/** Mounts the follow-only card shown on an author's own pages: a publication
 *  homepage, a Substack profile, or a YouTube channel. The card is only the
 *  button, and it is not mounted at all when the user already asked. Returns a
 *  teardown function either way. */
export async function mountFollowOverlay(ctx: ContentScriptContext, target: FollowTarget): Promise<() => void> {
  const follow = await buildFollowAction(target);
  if (follow.alreadyDone) return () => {};
  return mountCard(ctx, { headline: null, request: null, follow });
}
