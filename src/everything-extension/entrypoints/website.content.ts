import { browser, defineContentScript } from "#imports";

/** Where the Common Notes website runs. The dev build also marks localhost,
 *  where the website runs during development. */
const WEBSITE_PAGES = ["*://commonnotes.net/*", "*://*.commonnotes.net/*", "*://goodheart-labs.github.io/cn-return-bot/*"];
const DEV_WEBSITE_PAGES = ["http://localhost/*", "http://127.0.0.1/*"];

// Tells our own website that the extension is installed, so it stops
// suggesting the extension. It sets one attribute on <html> before the page
// draws, and runs on the website's pages only.
export default defineContentScript({
  matches: import.meta.env.VITE_CN_DEV_RELOAD ? [...WEBSITE_PAGES, ...DEV_WEBSITE_PAGES] : WEBSITE_PAGES,
  runAt: "document_start",
  main() {
    const mark = () => {
      document.documentElement.dataset.cnExtension = browser.runtime.getManifest().version;
    };
    // At document_start browsers already have the <html> element. Should one
    // not, the mark follows as soon as the document starts filling in, still
    // long before the website asks.
    if (document.documentElement) mark();
    else document.addEventListener("readystatechange", mark, { once: true });
  },
});
