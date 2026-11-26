import { browser, defineContentScript } from "#imports";
import { readSubstackPublicationFromPage } from "../utils/substackCreator";
import { SUBSTACK_DOMAIN_MESSAGE_TYPE } from "../utils/genericScript";

// A Substack newsletter on its own domain, such as jasmi.news, is matched by
// neither the static Substack script nor, until one of its pages has notes,
// the generic script that the noted-sites sync registers. So reading it
// recorded no visit, and its readers never counted towards its creator.
// This small script runs on every page. It only checks whether the page
// carries Substack's publication data, and it sends nothing over the network.
// On a Substack page it asks the background to inject the generic script,
// which then behaves as it does on *.substack.com.
export default defineContentScript({
  matches: ["<all_urls>"],
  // These hosts have their own scripts in the manifest (utils/staticSites.ts).
  excludeMatches: ["*://*.substack.com/*", "*://*.youtube.com/*", "*://*.youtu.be/*"],
  runAt: "document_idle",
  main() {
    if (!readSubstackPublicationFromPage()) return;
    // The catch swallows the "receiving end does not exist" error of a
    // script left behind by an extension reload.
    void browser.runtime.sendMessage({ type: SUBSTACK_DOMAIN_MESSAGE_TYPE }).catch(() => {});
  },
});
