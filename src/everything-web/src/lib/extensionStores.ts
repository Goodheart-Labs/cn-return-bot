/* Where each browser gets the extension. Edge installs extensions from the
 * Chrome Web Store, so it shares Chrome's listing. Safari has no version yet. */

const CHROME_WEB_STORE = "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij";
const FIREFOX_ADD_ONS = "https://addons.mozilla.org/en-US/firefox/addon/common-notes/";

export type BrowserId = "chrome" | "safari" | "firefox" | "edge";

export interface Browser {
  id: BrowserId;
  name: string;
  /** The store listing. Missing while the browser has no version yet. */
  storeUrl?: string;
  /** How installing works there, in a sentence or two. */
  howToInstall: string;
}

/** In the order of the install tabs. */
export const BROWSERS: readonly Browser[] = [
  {
    id: "chrome",
    name: "Chrome",
    storeUrl: CHROME_WEB_STORE,
    howToInstall: "Add Common Notes to Chrome for free from the Chrome Web Store. You need no account to read and rate notes.",
  },
  {
    id: "safari",
    name: "Safari",
    howToInstall: "A Safari version is coming soon. Until then, Common Notes works in Chrome, Firefox and Edge.",
  },
  {
    id: "firefox",
    name: "Firefox",
    storeUrl: FIREFOX_ADD_ONS,
    howToInstall: "Add Common Notes to Firefox for free from Firefox Add-ons. You need no account to read and rate notes.",
  },
  {
    id: "edge",
    name: "Edge",
    storeUrl: CHROME_WEB_STORE,
    howToInstall: "Edge installs extensions from the Chrome Web Store. Open the listing and allow extensions from other stores when Edge asks.",
  },
];

export const browserById = (id: BrowserId): Browser => BROWSERS.find((b) => b.id === id)!;

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
