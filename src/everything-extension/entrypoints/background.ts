import { defineBackground } from "#imports";
import { browser } from "#imports";
import { submitNoteRequest } from "../../everything-shared/noteRequests";
import { fetchReaderCanonical } from "../../everything-shared/notesQuery";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";
import { getEnabledOrigins, onEnabledOriginsChanged } from "../utils/settings";

const WRITE_MENU_ID = "cn-write-note";
const REQUEST_MENU_ID = "cn-request-note";
const INJECT_RETRY_DELAY_MS = 150;

// Sites whose content scripts the static manifest injects (keep in sync with
// notes.content.ts matches + the popup's DEFAULT_SITE).
const STATIC_TEXT_SITES = ["*://*.substack.com/*", "*://*.ai-2040.com/*"];

/** Selection context menus. Write-note is scoped to the sites the extension
 *  runs on (static text sites plus the user's opted-in origins) — clicking
 *  hands the selection to that tab's content script, which opens the
 *  write-note overlay. Request-a-note appears on EVERY OTHER page: the click
 *  itself grants activeTab, so we can inject its content script on demand
 *  without any host permissions. */
async function rebuildMenus() {
  await browser.contextMenus.removeAll();
  const origins = await getEnabledOrigins();
  browser.contextMenus.create({
    id: WRITE_MENU_ID,
    title: "Write a Common Note on this",
    contexts: ["selection"],
    documentUrlPatterns: [...STATIC_TEXT_SITES, ...origins.map((origin) => `${origin}/*`)],
  });
  browser.contextMenus.create({
    id: REQUEST_MENU_ID,
    title: "Request a Common Note",
    contexts: ["selection"],
  });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void rebuildMenus());
  onEnabledOriginsChanged(() => void rebuildMenus());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === WRITE_MENU_ID && tab?.id != null) {
      browser.tabs.sendMessage(tab.id, { type: "cn-write-note", selection: info.selectionText ?? "" }).catch(() => {});
    }
    if (info.menuItemId === REQUEST_MENU_ID && tab?.id != null) {
      const tabId = tab.id;
      (async () => {
        // Re-injection on repeat clicks is a no-op (the script guards with a
        // window flag). executeScript fails only on restricted pages
        // (chrome://, Web Store) — swallowed. The one retry covers WXT
        // scheduling the script's listener registration a beat after the
        // file's top level finishes evaluating.
        await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/requestnote.js"] });
        const message = { type: "cn-request-note", selection: info.selectionText ?? "" };
        await browser.tabs.sendMessage(tabId, message).catch(async () => {
          await new Promise((resolve) => setTimeout(resolve, INJECT_RETRY_DELAY_MS));
          await browser.tabs.sendMessage(tabId, message);
        });
      })().catch(() => {});
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    // Dev-only (compiled out of store builds): reload the unpacked extension
    // from disk on request from a content script — see utils/devReload.ts.
    if (import.meta.env.VITE_CN_DEV_RELOAD && (message as { type?: string })?.type === "cn-dev-reload") {
      browser.runtime.reload();
      return undefined;
    }
    if ((message as { type?: string })?.type === "cn-signin-x") {
      // The OAuth window outlives the popup that asked for it, so the flow
      // runs here in the background.
      signInWithXViaWebAuthFlow().then(sendResponse);
      return true; // async response
    }
    if ((message as { type?: string })?.type === "cn-reader-canonical") {
      // Substack reader URLs 302 cross-origin to the publication domain when
      // fetched without cookies; content scripts can't follow that (CORS), so
      // the fetch runs here where the *.substack.com host permission applies.
      fetchReaderCanonical((message as { href: string }).href).then(sendResponse);
      return true; // async response
    }
    if ((message as { type?: string })?.type === "cn-request-note-run") {
      // Runs here, not in the content script: request-note injects into
      // ARBITRARY pages, where a strict page CSP could block a content-script
      // fetch to Supabase. Background fetches are exempt from page CSP.
      const { selection, pageTitle, pageUrl } = message as { selection: string; pageTitle: string; pageUrl: string };
      submitNoteRequest({ pageUrl, pageTitle, selection })
        .then(() => sendResponse({ ok: true }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true; // async response
    }
    return undefined;
  });
});
