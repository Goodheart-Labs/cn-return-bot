import type { ContentScriptContext } from "#imports";
import { browser } from "#imports";
import { mountInfoOverlay } from "./mountInfoOverlay";

// The card hides itself after the StatusOverlay auto-hide. Tearing the mount
// down a little later removes its shadow root too, so repeated clicks cannot
// pile up roots.
const INFO_CARD_LIFETIME_MS = 15_000;

/** Shows a card in the page that says how a request went. */
export function showInfoCard(ctx: ContentScriptContext, headline: string): void {
  void mountInfoOverlay(ctx, headline).then((teardown) => setTimeout(teardown, INFO_CARD_LIFETIME_MS));
}

/** Shows the background's explanation card when a note request was not needed,
 *  for example because the page is already checked. Registered once per
 *  content script, whatever else is mounted on the page. */
export function listenForRequestInfo(ctx: ContentScriptContext): void {
  const listener = (message: unknown) => {
    const { type, headline } = (message as { type?: string; headline?: string }) ?? {};
    if (type !== "cn-request-info" || !headline) return;
    showInfoCard(ctx, headline);
  };
  browser.runtime.onMessage.addListener(listener);
  ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener));
}
