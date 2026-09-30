import { browser } from "#imports";

/* The toolbar icon follows the browser's light or dark mode. In light mode it
 * is the plain blue notes. In dark mode it is the blue notes on a black tile,
 * because plain blue notes nearly vanish on the mid greys of a dark toolbar.
 * Chrome's manifest takes a single toolbar icon, and its background worker
 * cannot ask for the colour scheme. So an offscreen document, a hidden
 * extension page Chrome allows for exactly this ("MATCH_MEDIA"), reads it and
 * reports every change. Firefox needs none of this: its manifest names both
 * icons in action.theme_icons (wxt.config.ts). */

export const COLOR_SCHEME_MESSAGE_TYPE = "cn-color-scheme";
export interface ColorSchemeMessage {
  type: typeof COLOR_SCHEME_MESSAGE_TYPE;
  dark: boolean;
}

const OFFSCREEN_PAGE = "/offscreen.html";
const LIGHT_MODE_ICON = { 16: "/icon/16.png", 32: "/icon/32.png" };
const DARK_MODE_ICON = { 16: "/icon/tile-16.png", 32: "/icon/tile-32.png" };

export function showToolbarIconFor({ dark }: ColorSchemeMessage) {
  return browser.action.setIcon({ path: dark ? DARK_MODE_ICON : LIGHT_MODE_ICON });
}

/** Opens the offscreen document unless it is already open. It lives until the
 *  browser or the extension restarts, while the worker comes and goes, so
 *  every worker boot checks. Firefox has no offscreen API. */
export async function watchColorScheme() {
  if (!browser.offscreen) return;
  if (await browser.offscreen.hasDocument()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_PAGE,
    reasons: [browser.offscreen.Reason.MATCH_MEDIA],
    justification: "Reads the browser's light or dark mode, so the toolbar icon stays visible in dark mode.",
  });
}
