import { defineBackground } from "#imports";
import { browser } from "#imports";
import { fetchCoveredPageUrls, fetchReaderCanonical } from "../../everything-shared/notesQuery";
import { track } from "../../everything-shared/analytics";
import { initBackgroundAnalytics } from "../utils/analytics";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";
import { COVERED_PAGE_URLS_KEY } from "../utils/coveredPages";
import { GENERIC_SCRIPT_PREFIX, hostnamePattern, registerGenericScripts, genericScriptId } from "../utils/genericScript";
import { ASSUME_ALL_URLS } from "../utils/permissionsMode";
import { getDismissedGrantHosts } from "../utils/settings";
import { STATIC_SITE_HOSTNAME } from "../utils/staticSites";

const WRITE_MENU_ID = "cn-write-note";
const INJECT_RETRY_DELAY_MS = 150;
const INJECT_RETRY_ATTEMPTS = 10;
const SYNC_ALARM = "cn-sync-noted-sites";
const SYNC_PERIOD_MINUTES = 5;

/** Hostnames of covered pages outside the static sites — where the generic
 *  content script belongs. */
function genericHostnames(urls: string[]): string[] {
  const hostnames = new Set<string>();
  for (const url of urls) {
    try {
      const { protocol, hostname } = new URL(url);
      if (!/^https?:$/.test(protocol) || STATIC_SITE_HOSTNAME.test(hostname)) continue;
      hostnames.add(hostname);
    } catch {
      // synthetic local: keys
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

/** The hostnames we may register without asking: all of them when
 *  <all_urls> is required at install, else only the origins the user granted
 *  through grant.html (permission survives; registration is re-derived). */
async function registrableHostnames(noted: string[]): Promise<string[]> {
  if (ASSUME_ALL_URLS) return noted;
  const granted = await Promise.all(noted.map((hostname) =>
    browser.permissions.contains({ origins: [hostnamePattern(hostname)] }).catch(() => false)));
  return noted.filter((_, i) => granted[i]);
}

/** Registration only affects FUTURE page loads — tabs already open on a
 *  newly-covered host get the script injected directly (the script's own
 *  window flag makes a double arrival a no-op), so a popup-triggered sync
 *  shows notes in the current tab without a reload. Hosts here are freshly
 *  REGISTERED, i.e. granted — consent-clean in both modes. */
async function injectIntoOpenTabs(hostnames: string[]) {
  for (const hostname of hostnames) {
    const tabs = await browser.tabs.query({ url: hostnamePattern(hostname) }).catch(() => []);
    await Promise.all(tabs.map((tab) => tab.id != null
      ? browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {})
      : undefined));
  }
}

/** Keep the generic content-script registrations in step with the covered
 *  sites — a new site goes live for existing installs straight from the DB
 *  on the next sync, without a store update. The covered PAGE list is also
 *  cached for the content scripts' on-device checks and the redirect-mode
 *  navigation listener. */
async function syncNotedSites() {
  try {
    const urls = await fetchCoveredPageUrls();
    if (urls) {
      await browser.storage.local.set({ [COVERED_PAGE_URLS_KEY]: urls });
      const wanted = new Set(await registrableHostnames(genericHostnames(urls)));
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

/** Redirect mode: a navigation to a noted site we can't inject into yet
 *  detours through grant.html, whose Allow click is the user gesture a
 *  permission request needs. Dismissals ("Not now") are remembered per host
 *  so the detour never becomes a nag loop. */
async function offerGrantOnNavigation(tabId: number, url: string) {
  if (!/^https?:/.test(url)) return;
  const hostname = new URL(url).hostname;
  if (STATIC_SITE_HOSTNAME.test(hostname)) return;
  const { [COVERED_PAGE_URLS_KEY]: covered = [] } = await browser.storage.local.get(COVERED_PAGE_URLS_KEY);
  if (!genericHostnames(covered as string[]).includes(hostname)) return;
  if (await browser.permissions.contains({ origins: [hostnamePattern(hostname)] }).catch(() => false)) return;
  if ((await getDismissedGrantHosts()).includes(hostname)) return;
  await browser.tabs.update(tabId, {
    url: browser.runtime.getURL(`/grant.html?host=${encodeURIComponent(hostname)}&back=${encodeURIComponent(url)}`),
  });
}

/** One selection menu, on EVERY page — writing works anywhere now. On a
 *  covered page the mounted content script opens the overlay directly; on an
 *  uncovered page the click's activeTab grant authorizes injecting the
 *  script on demand, and posting lazily creates the page's item. */
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
  // Sync on install/update and browser start; the 5-minute alarm keeps
  // long-lived sessions current (the MV3 worker can't hold a timer), and
  // the popup pings cn-sync-noted-sites on open.
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

  if (!ASSUME_ALL_URLS) {
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url) void offerGrantOnNavigation(tabId, changeInfo.url).catch(() => {});
    });
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === WRITE_MENU_ID && tab?.id != null) {
      const tabId = tab.id;
      const message = { type: "cn-write-note", selection: info.selectionText ?? "" };
      (async () => {
        try {
          await browser.tabs.sendMessage(tabId, message);
        } catch {
          // Uncovered page — no script there yet. The menu click's activeTab
          // grant authorizes injecting on demand (executeScript fails only on
          // restricted pages: chrome://, the Web Store); the mount needs a
          // beat before its listener answers, hence the retries.
          await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/generic.js"] });
          for (let attempt = 0; attempt < INJECT_RETRY_ATTEMPTS; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, INJECT_RETRY_DELAY_MS));
            try {
              await browser.tabs.sendMessage(tabId, message);
              return;
            } catch {
              // listener not up yet — keep trying
            }
          }
        }
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
    if ((message as { type?: string })?.type === "cn-sync-noted-sites") {
      // The popup pings this on open so a fresh site reaches the current
      // session immediately instead of on the next scheduled tick.
      syncNotedSites().then(() => sendResponse({ ok: true }));
      return true; // async response
    }
    return undefined;
  });
});
