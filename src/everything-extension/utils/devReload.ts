import { browser } from "#imports";
import type { ContentScriptContext } from "#imports";

/** A self-reload hook that only exists in dev builds. Dispatching a
 *  `cn-dev-reload` event on `window` from the page itself, on any page the
 *  extension runs on, makes the background reload the extension from disk.
 *  This is how a Claude session picks up a fresh `bun run build-ext-dev`
 *  without a human clicking the reload button. Store builds leave
 *  VITE_CN_DEV_RELOAD unset, so this compiles away. */
export function registerDevReloadHook(ctx: ContentScriptContext) {
  if (!import.meta.env.VITE_CN_DEV_RELOAD) return;
  // build-ext-dev stamps this build id in. It tells you which build a tab is
  // running, which you cannot otherwise see from the page. A runtime.reload()
  // leaves the old content scripts running until the tab itself reloads.
  console.debug(`[common-notes] dev build ${import.meta.env.VITE_CN_BUILD ?? "?"}`);
  // The same stamp goes onto the DOM, because that is the only place a
  // scripted check can read it from. AppleScript's "execute javascript" runs
  // in the page's own world and cannot see into the content script. The
  // Mac's reload script compares this against the build on disk to know
  // whether a reload is needed and whether it worked.
  document.documentElement.dataset.cnDevBuild = import.meta.env.VITE_CN_BUILD ?? "?";
  ctx.addEventListener(window, "cn-dev-reload" as keyof WindowEventMap, () => {
    // We report the failure. A sendMessage that fails silently, because the
    // service worker died or the context was invalidated, would leave an
    // extension that does not reload and gives no clue why.
    browser.runtime.sendMessage({ type: "cn-dev-reload" })
      .catch((err) => console.warn("[common-notes] dev reload request failed:", err));
  });
}
