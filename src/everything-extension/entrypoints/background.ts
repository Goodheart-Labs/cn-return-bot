import { defineBackground } from "#imports";
import { browser } from "#imports";
import { fetchCoveredPageUrls, fetchNotedPageCounts, fetchReaderCanonical } from "../../everything-shared/notesQuery";
import { track } from "../../everything-shared/analytics";
import { initBackgroundAnalytics } from "../utils/analytics";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";
import { COVERED_PAGE_URLS_KEY, NOTED_PAGE_COUNTS_KEY } from "../utils/coveredPages";
import { GENERIC_SCRIPT_PREFIX, hostnamePattern, registerGenericScripts, genericScriptId } from "../utils/genericScript";
import { getDisabledSites, onDisabledSitesChanged } from "../utils/settings";
import { STATIC_SITE_HOSTNAME } from "../utils/staticSites";

const WRITE_MENU_ID = "cn-write-note";
const INJECT_RETRY_DELAY_MS = 150;
const INJECT_RETRY_ATTEMPTS = 10;
const SYNC_ALARM = "cn-sync-noted-sites";
const SYNC_PERIOD_MINUTES = 5;

/** The hostnames of covered pages that are not static sites. These are the
 *  hostnames the generic content script belongs on. */
function genericHostnames(urls: string[]): string[] {
  const hostnames = new Set<string>();
  for (const url of urls) {
    try {
      const { protocol, hostname } = new URL(url);
      if (!/^https?:$/.test(protocol) || STATIC_SITE_HOSTNAME.test(hostname)) continue;
      hostnames.add(hostname);
    } catch {
      // The entry is not a parseable URL, so it covers no website.
    }
  }
  return [...hostnames];
}

async function registeredGenericHostnames(): Promise<string[]> {
  const scripts = await browser.scripting.getRegisteredContentScripts();
  return scripts
    .map((s) => s.id)
    .filter((id) => id.startsWith(GENERIC_SCRIPT_PREFIX))
    .map((id) => id.slice(GENERIC_SCRIPT_PREFIX.length));
}

/** The hostnames the sync should have a registration for. That is every noted
 *  hostname except the sites the user switched notes off for. The list is
 *  worked out again on every sync, so toggling a site in the popup takes
 *  effect on the next sync it triggers. */
async function enabledHostnames(noted: string[]): Promise<string[]> {
  const disabled = new Set(await getDisabledSites());
  return noted.filter((hostname) => !disabled.has(hostname));
}

/** Registering a script only affects future page loads. So tabs that are
 *  already open on a newly covered host get the script injected directly, and
 *  a sync triggered from the popup shows notes in the current tab without a
 *  reload. The script sets a flag on `window`, so a second copy arriving does
 *  nothing. */
async function injectIntoOpenTabs(hostnames: string[]) {
  for (const hostname of hostnames) {
    const tabs = await browser.tabs.query({ url: hostnamePattern(hostname) }).catch(() => []);
    await Promise.all(tabs.map((tab) => tab.id != null
      ? browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {})
      : undefined));
  }
}

/** Keep the generic content-script registrations in step with the covered
 *  sites. A newly covered site goes live on existing installs on the next
 *  sync, straight from the database, without a store update. This also caches
 *  the list of covered pages. The content scripts use that list for their
 *  on-device checks, and so does the navigation listener in redirect mode. */
async function syncNotedSites() {
  try {
    const [urls, counts] = await Promise.all([fetchCoveredPageUrls(), fetchNotedPageCounts()]);
    // The listing badges draw their per-page note counts from this cache.
    if (counts) await browser.storage.local.set({ [NOTED_PAGE_COUNTS_KEY]: counts });
    if (urls) {
      await browser.storage.local.set({ [COVERED_PAGE_URLS_KEY]: urls });
      const wanted = new Set(await enabledHostnames(genericHostnames(urls)));
      const existing = new Set(await registeredGenericHostnames());
      const toAdd = [...wanted].filter((hostname) => !existing.has(hostname));
      const toRemove = [...existing].filter((hostname) => !wanted.has(hostname));
      if (toAdd.length) {
        await registerGenericScripts(toAdd);
        await injectIntoOpenTabs(toAdd);
      }
      if (toRemove.length) {
        await browser.scripting.unregisterContentScripts({ ids: toRemove.map(genericScriptId) });
      }
    }
  } catch (err) {
    console.warn("[common-notes] noted-sites sync failed:", err);
  }
}

/** There is one selection menu and it sits on every page, because writing a
 *  note works anywhere. On a covered page the content script is already
 *  mounted and opens the overlay directly. On an uncovered page the menu click
 *  grants activeTab, which lets us inject the script on demand, and posting
 *  creates the page's item at that point. */
async function createMenus() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: WRITE_MENU_ID,
    title: "Write a Common Note on this",
    contexts: ["selection"],
  });
}

export default defineBackground(() => {
  initBackgroundAnalytics();
  // We sync on install, on update, and on browser start. The five-minute
  // alarm keeps long-running sessions current, because an MV3 service worker
  // cannot hold a timer of its own. The popup also asks for a sync when it
  // opens.
  const startSync = () => {
    browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
    void syncNotedSites();
  };
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") track("extension_installed");
    void createMenus();
    startSync();
  });
  browser.runtime.onStartup.addListener(startSync);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncNotedSites();
  });
  // Toggling a site in the popup registers or unregisters its script right
  // away, so the choice holds on the next page load and not only after the
  // next scheduled sync.
  onDisabledSitesChanged(() => void syncNotedSites());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === WRITE_MENU_ID && tab?.id != null) {
      const tabId = tab.id;
      const message = { type: "cn-write-note", selection: info.selectionText ?? "" };
      (async () => {
        try {
          await browser.tabs.sendMessage(tabId, message);
        } catch {
          // The page is uncovered, so no script is running there yet. The menu
          // click grants activeTab, which lets us inject one on demand. That
          // only fails on restricted pages such as chrome:// and the Web
          // Store. The script needs a moment to mount before its listener
          // answers, which is why we retry.
          await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/generic.js"] });
          for (let attempt = 0; attempt < INJECT_RETRY_ATTEMPTS; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, INJECT_RETRY_DELAY_MS));
            try {
              await browser.tabs.sendMessage(tabId, message);
              return;
            } catch {
              // The listener is not up yet, so we try again.
            }
          }
        }
      })().catch(() => {});
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    // This reloads the unpacked extension from disk when a content script asks
    // for it. See utils/devReload.ts. Store builds compile it out.
    if (import.meta.env.VITE_CN_DEV_RELOAD && (message as { type?: string })?.type === "cn-dev-reload") {
      browser.runtime.reload();
      return undefined;
    }
    if ((message as { type?: string })?.type === "cn-signin-x") {
      // The OAuth window outlives the popup that asked for it, so the flow
      // runs here in the background.
      signInWithXViaWebAuthFlow().then(sendResponse);
      return true; // Keep the message channel open for the async reply.
    }
    if ((message as { type?: string })?.type === "cn-reader-canonical") {
      // A Substack reader URL redirects to the publication's own domain when
      // it is fetched without cookies. A content script cannot follow that
      // redirect, because CORS blocks it. So the fetch runs here in the
      // background, where our *.substack.com host permission applies.
      fetchReaderCanonical((message as { href: string }).href).then(sendResponse);
      return true; // Keep the message channel open for the async reply.
    }
    if ((message as { type?: string })?.type === "cn-sync-noted-sites") {
      // The popup sends this when it opens, so that a newly covered site
      // reaches the current session right away instead of on the next
      // scheduled tick.
      syncNotedSites().then(() => sendResponse({ ok: true }));
      return true; // Keep the message channel open for the async reply.
    }
    return undefined;
  });
});
