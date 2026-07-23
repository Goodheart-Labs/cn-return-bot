import { browser } from "#imports";
import type { ContentScriptContext } from "#imports";

/** Dev-only self-reload: a page-world `window.dispatchEvent(new
 *  Event("cn-dev-reload"))` on any page the extension runs on makes the
 *  background reload the extension from disk — how a Claude session picks up
 *  a fresh `bun run build-ext-dev` without a human clicking ↻. Store builds
 *  compile this out (VITE_CN_DEV_RELOAD unset). */
export function registerDevReloadHook(ctx: ContentScriptContext) {
  if (!import.meta.env.VITE_CN_DEV_RELOAD) return;
  // Stamped by build-ext-dev; proves which build a tab is running, since a
  // runtime.reload() is otherwise invisible from the page (old content
  // scripts linger as zombies until the tab reloads).
  console.debug(`[common-notes] dev build ${import.meta.env.VITE_CN_BUILD ?? "?"}`);
  ctx.addEventListener(window, "cn-dev-reload" as keyof WindowEventMap, () => {
    void browser.runtime.sendMessage({ type: "cn-dev-reload" }).catch(() => {});
  });
}
