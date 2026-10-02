// eslint-disable-next-line no-restricted-imports -- This is the one place allowed to call it.
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext, ShadowRootContentScriptUi, ShadowRootContentScriptUiOptions } from "#imports";

/** Keyboard events that must never leave our UI. */
const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

/** Mounts a piece of our UI into a host page inside its own shadow root, which
 *  is a separate DOM subtree whose styles and events stay apart from the
 *  page's. Every overlay, card and popover the extension shows goes through
 *  here. ESLint forbids calling WXT's createShadowRootUi anywhere else.
 *
 *  The one thing this adds is that key presses typed into our UI never reach
 *  the host page. When an event leaves a shadow root, the page sees it as
 *  coming from the shadow host element rather than from our text field. So
 *  the page's own "is the reader typing?" check fails, and its single-key
 *  shortcuts fire: YouTube's k, f, m and the digits, Substack's shortcuts, and
 *  whatever the next site adds. We stop every key event at the shadow root.
 *  Our own React handlers still run, because React listens on its container
 *  inside the shadow root, which the event passes first.
 *
 *  A page listener in the capture phase on window or document runs before the
 *  event reaches us, so it is not stopped. Substack registers several, but
 *  they only track focus styling and pointer state. Its shortcuts come from
 *  the Mousetrap library, which listens in the bubble phase, as do YouTube's.
 *  We checked both in headless Chromium on 2026-10-01. */
export async function createOverlayUi<TMounted>(
  ctx: ContentScriptContext,
  options: ShadowRootContentScriptUiOptions<TMounted>,
): Promise<ShadowRootContentScriptUi<TMounted>> {
  const ui = await createShadowRootUi(ctx, options);
  for (const type of KEY_EVENTS) ui.shadow.addEventListener(type, (event) => event.stopPropagation());
  return ui;
}
