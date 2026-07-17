import { defineBackground } from "#imports";
import { browser } from "#imports";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";
import { getEnabledOrigins, onEnabledOriginsChanged } from "../utils/settings";

const WRITE_MENU_ID = "cn-write-note";

/** Selection context menu on the sites the extension runs on (static Substack
 *  plus the user's opted-in origins). Clicking hands the selection to that
 *  tab's content script, which opens the write-note overlay. */
async function rebuildWriteMenu() {
  await browser.contextMenus.removeAll();
  const origins = await getEnabledOrigins();
  browser.contextMenus.create({
    id: WRITE_MENU_ID,
    title: "Write a Common Note on this",
    contexts: ["selection"],
    documentUrlPatterns: ["*://*.substack.com/*", ...origins.map((origin) => `${origin}/*`)],
  });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void rebuildWriteMenu());
  onEnabledOriginsChanged(() => void rebuildWriteMenu());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === WRITE_MENU_ID && tab?.id != null) {
      browser.tabs.sendMessage(tab.id, { type: "cn-write-note", selection: info.selectionText ?? "" }).catch(() => {});
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if ((message as { type?: string })?.type === "cn-signin-x") {
      // The OAuth window outlives the popup that asked for it, so the flow
      // runs here in the background.
      signInWithXViaWebAuthFlow().then(sendResponse);
      return true; // async response
    }
    return undefined;
  });
});
