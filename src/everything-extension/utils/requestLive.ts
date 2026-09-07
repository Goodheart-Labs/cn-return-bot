import type { ContentScriptContext } from "#imports";
import { normalizePageUrl } from "../../everything-shared/pageUrls";
import { progressIsTerminal } from "../../everything-shared/requestProgress";
import { jumpToNextNote } from "./jumpBus";
import { getLiveRequest, removeLiveRequest, saveLiveRequest, type LiveRequest } from "./liveRequests";
import { mountRequestProgress, type RequestProgressHandle } from "./mountRequestProgress";
import type { RequestProgress } from "../../everything-shared/requestProgress";
import { watchRequestProgress, type RequestWatch } from "./requestProgressController";

/** Fired on the page's window whenever the request behind the live card has
 *  produced a new note, and once when it finishes. The notes mount listens and
 *  rebuilds, which is what makes a fresh note appear as a highlight on a page
 *  that had no notes UI when it loaded. */
export const REQUEST_NOTES_CHANGED_EVENT = "cn-request-notes-changed";

function notesShown(progress: RequestProgress): number {
  if (progress.kind === "checking" || progress.kind === "done") return progress.notes;
  return 0;
}
import { resolveReaderCanonical } from "./readerCanonical";

/** Wires the live-progress card into a page. Two things start it: the
 *  cn-request-live message the background or the popup sends right after a
 *  request was submitted, and a stored live entry for the current page, which
 *  is how the card comes back after a navigation. Registered once per content
 *  script, whatever else is mounted on the page. */
export function listenForLiveRequests(ctx: ContentScriptContext): void {
  let card: RequestProgressHandle | null = null;
  let watch: RequestWatch | null = null;
  let shownPageUrl: string | null = null;

  const teardown = () => {
    watch?.stop();
    watch = null;
    card?.teardown();
    card = null;
    shownPageUrl = null;
  };

  // The message and the startup restore can race for the same request, so a
  // stale start throws its mount away instead of leaving two cards behind.
  let seq = 0;
  const start = async (entry: LiveRequest) => {
    const mine = ++seq;
    teardown();
    shownPageUrl = entry.pageUrl;
    const handle = await mountRequestProgress(ctx, {
      onJump: jumpToNextNote,
      // Dismissing removes only the card. The request keeps running, and the
      // stored entry stays, so a reload brings the card back until the
      // request actually finishes.
      onDismiss: teardown,
    });
    if (mine !== seq) return handle.teardown();
    card = handle;
    let seenNotes = 0;
    watch = watchRequestProgress({
      token: entry.token,
      itemId: entry.itemId,
      onItemFound: (itemId) => void saveLiveRequest({ ...entry, itemId }).catch(() => {}),
      onProgress: (progress) => {
        handle.update(progress);
        // Every new note, and the finish itself, pokes the notes mount so the
        // highlights on the page catch up with what was just written.
        const notes = notesShown(progress);
        if (notes > seenNotes || (progress.kind === "done" && seenNotes === 0)) {
          seenNotes = Math.max(notes, seenNotes);
          window.dispatchEvent(new CustomEvent(REQUEST_NOTES_CHANGED_EVENT));
        }
        if (progressIsTerminal(progress)) void removeLiveRequest(entry.pageUrl).catch(() => {});
      },
    });
  };

  const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
  const listener = (message: unknown) => {
    const { type, pageUrl, token } = (message as { type?: string; pageUrl?: string; token?: string }) ?? {};
    if (type !== "cn-request-live" || !pageUrl || !token) return;
    // The startup restore may already be showing this very request.
    if (pageUrl === shownPageUrl && card) return;
    // The sender saved the entry before messaging, so the stored one, which
    // may already know the item, wins over a fresh construction.
    void getLiveRequest(pageUrl)
      .then((stored) => start(stored ?? { pageUrl, token, requestedAt: Date.now() }))
      .catch(() => {});
  };
  runtime?.onMessage.addListener(listener);
  ctx.onInvalidated(() => {
    runtime?.onMessage.removeListener(listener);
    teardown();
  });

  // Restores the card from the stored state when this page has a live
  // request, and drops it again when a single-page-app navigation leaves the
  // requested page.
  const restore = async (href: string) => {
    const readerCanonical = await resolveReaderCanonical(href);
    const pageUrl = readerCanonical ? normalizePageUrl(readerCanonical) : normalizePageUrl(href, document);
    if (pageUrl === shownPageUrl) return;
    const entry = await getLiveRequest(pageUrl);
    if (entry) await start(entry);
    else if (card) teardown();
  };
  void restore(location.href).catch(() => {});
  ctx.addEventListener(window, "wxt:locationchange", (event) => void restore(String(event.newUrl)).catch(() => {}));
}
