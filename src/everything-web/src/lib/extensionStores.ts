import chromeLogo from "@browser-logos/chrome/chrome.svg";
import { track } from "@cn/core/analytics";
import edgeLogo from "@browser-logos/edge/edge.svg";
import firefoxLogo from "@browser-logos/firefox/firefox.svg";
import safariLogo from "@browser-logos/safari/safari.svg";

/* Where each browser gets the extension. Edge installs extensions from the
 * Chrome Web Store, so it shares Chrome's listing. Safari has no version yet.
 * The logos are the browsers' official ones, from the browser-logos project. */

const CHROME_WEB_STORE = { url: "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij", name: "the Chrome Web Store" };
const FIREFOX_ADD_ONS = { url: "https://addons.mozilla.org/en-US/firefox/addon/common-notes/", name: "Firefox Add-ons" };

export type BrowserId = "chrome" | "safari" | "firefox" | "edge";

export interface Browser {
  id: BrowserId;
  name: string;
  logo: string;
  /** The store listing. Missing while the browser has no version yet. */
  store?: { url: string; name: string };
}

/** In the order of the install tabs. */
export const BROWSERS: readonly Browser[] = [
  { id: "chrome", name: "Chrome", logo: chromeLogo, store: CHROME_WEB_STORE },
  { id: "safari", name: "Safari", logo: safariLogo },
  { id: "firefox", name: "Firefox", logo: firefoxLogo, store: FIREFOX_ADD_ONS },
  { id: "edge", name: "Edge", logo: edgeLogo, store: CHROME_WEB_STORE },
];

/** A browser whose version of the extension is in a store. */
export type ListedBrowser = Browser & { store: NonNullable<Browser["store"]> };
export const isListed = (browser: Browser): browser is ListedBrowser => !!browser.store;

export const browserById = (id: BrowserId): Browser => BROWSERS.find((b) => b.id === id)!;

/** Browser extensions exist on desktop browsers only, which a fine pointer
 *  such as a mouse or a trackpad gives away. Phones and tablets have none, so
 *  they get a sentence instead of a store button. */
export const canInstallExtensions = () => window.matchMedia("(pointer: fine)").matches;

/** Counts a click on a store link (migration 103). */
export const trackStoreClick = (browser: Browser) => track("extension_store_clicked", { browser: browser.name });

/** The reader's browser, read from the user agent. Edge and Firefox name
 *  themselves. Safari is the one that says Safari without also saying Chrome,
 *  because every Chromium browser includes "Safari" in its user agent too.
 *  Anything else counts as Chrome. */
export function detectBrowser(userAgent: string = navigator.userAgent): BrowserId {
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Safari\//.test(userAgent) && !/Chrom(e|ium)\//.test(userAgent)) return "safari";
  return "chrome";
}
