import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { submitFollowRequest, submitNoteRequest } from "../../everything-shared/noteRequests";
import { StatusOverlay, type StatusAction } from "../components/StatusOverlay";
import { readPageForRequest } from "./pageCapture";
import type { FollowTarget } from "./followTarget";
import { isPageDark } from "./pageTheme";
import { addRequestedFollow, addRequestedPage, getRequestedFollows, getRequestedPages } from "./settings";

export interface StatusOverlayParams {
  pageUrl: string;
  noun: "post" | "video" | "page";
  /** Null while the page has not been checked, otherwise its note count. */
  checked: { noteCount: number } | null;
  authorCovered: boolean;
  followTarget: FollowTarget | null;
  /** Whether a request should carry the page's body text. On it stays for text
   *  pages, off for YouTube, where the pipeline fetches the transcript itself
   *  and the page text is player chrome. */
  requestWithPageText: boolean;
}

/** Requesting and following are remembered on the device, so reopening the
 *  page shows the confirmation instead of offering the button again. */
async function buildActions(params: StatusOverlayParams): Promise<{ request: StatusAction | null; follow: StatusAction | null }> {
  if (params.checked) return { request: null, follow: null };
  const request: StatusAction = {
    label: "Request Common Notes",
    doneLabel: "Requested — we'll check this page when it comes up in our queue.",
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
  const target = params.followTarget;
  const follow: StatusAction | null =
    target && !params.authorCovered
      ? {
          label: `Ask us to follow this ${target.kind}`,
          doneLabel: "Follow requested — new posts get checked once it's added.",
          alreadyDone: (await getRequestedFollows()).includes(target.feedUrl),
          run: async () => {
            await submitFollowRequest({ feedType: target.feedType, feedUrl: target.feedUrl, title: target.title });
            await addRequestedFollow(target.feedUrl).catch(() => {});
          },
        }
      : null;
  return { request, follow };
}

/** Mounts the transient "have we checked this yet" card in its own shadow root
 *  and returns a teardown function. */
export async function mountStatusOverlay(ctx: ContentScriptContext, params: StatusOverlayParams): Promise<() => void> {
  const { request, follow } = await buildActions(params);
  let root: Root | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-status",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      root.render(
        <StatusOverlay
          noun={params.noun}
          checked={params.checked}
          authorCovered={params.authorCovered}
          request={request}
          follow={follow}
        />,
      );
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}
