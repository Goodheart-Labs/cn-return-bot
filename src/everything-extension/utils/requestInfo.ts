import type { ContentScriptContext } from "#imports";
import { mountInfoOverlay } from "./mountStatusOverlay";

// The card hides itself after 10 seconds; tearing the mount down a little
// later removes its shadow root too, so repeated clicks cannot pile up roots.
const INFO_CARD_LIFETIME_MS = 15_000;

/** Shows the background's explanation card when a note request was not needed,
 *  for example because the page is already checked. Registered once per
 *  content script, whatever else is mounted on the page. */
export function listenForRequestInfo(ctx: ContentScriptContext): void {
  const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
  const listener = (message: unknown) => {
    const { type, headline } = (message as { type?: string; headline?: string }) ?? {};
    if (type !== "cn-request-info" || !headline) return;
    void mountInfoOverlay(ctx, headline).then((teardown) => setTimeout(teardown, INFO_CARD_LIFETIME_MS));
  };
  runtime?.onMessage.addListener(listener);
  ctx.onInvalidated(() => runtime?.onMessage.removeListener(listener));
}
