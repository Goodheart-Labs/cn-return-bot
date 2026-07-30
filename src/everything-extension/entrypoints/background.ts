import { defineBackground } from "#imports";
import { browser } from "#imports";
import { submitNoteRequest } from "../../everything-shared/noteRequests";
import { fetchNotedPageUrls, fetchReaderCanonical } from "../../everything-shared/notesQuery";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";
import { GENERIC_SCRIPT_PREFIX, hostnamePattern, registerGenericScripts, genericScriptId } from "../utils/genericScript";
import { ASSUME_ALL_URLS } from "../utils/permissionsMode";
import { getDismissedGrantHosts } from "../utils/settings";
import { STATIC_SITE_HOSTNAME, STATIC_TEXT_SITE_PATTERNS } from "../utils/staticSites";

const WRITE_MENU_ID = "cn-write-note";
const REQUEST_MENU_ID = "cn-request-note";
const INJECT_RETRY_DELAY_MS = 150;
const SYNC_ALARM = "cn-sync-noted-sites";
const SYNC_PERIOD_MINUTES = 60;
// Noted hostnames from the last sync, readable by the navigation listener
// without a DB round-trip per page load (redirect mode).
const NOTED_HOSTNAMES_KEY = "cn:notedHostnames";

/** Hostnames of noted pages outside the static sites — where the generic
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

/** Keep the generic content-script registrations in step with the sites that
 *  have notes — a new site goes live for existing installs straight from the
 *  DB on the next sync, without a store update. In redirect mode the noted
 *  list also feeds the navigation listener below. */
async function syncNotedSites() {
  try {
    const urls = await fetchNotedPageUrls();
    if (urls) {
      const noted = genericHostnames(urls);
      await browser.storage.local.set({ [NOTED_HOSTNAMES_KEY]: noted });
      const wanted = new Set(await registrableHostnames(noted));
      const existing = new Set(await registeredGenericHostnames());
      const toAdd = [...wanted].filter((hostname) => !existing.has(hostname));
      const toRemove = [...existing].filter((hostname) => !wanted.has(hostname));
      if (toAdd.length) await registerGenericScripts(toAdd);
      if (toRemove.length) {
        await browser.scripting.unregisterContentScripts({ ids: toRemove.map(genericScriptId) });
      }
    }
    await rebuildMenus(await registeredGenericHostnames());
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
  const { [NOTED_HOSTNAMES_KEY]: noted = [] } = await browser.storage.local.get(NOTED_HOSTNAMES_KEY);
  if (!(noted as string[]).includes(hostname)) return;
  if (await browser.permissions.contains({ origins: [hostnamePattern(hostname)] }).catch(() => false)) return;
  if ((await getDismissedGrantHosts()).includes(hostname)) return;
  await browser.tabs.update(tabId, {
    url: browser.runtime.getURL(`/grant.html?host=${encodeURIComponent(hostname)}&back=${encodeURIComponent(url)}`),
  });
}

/** Selection context menus. Write-note is scoped to the sites the extension
 *  runs on (static text sites plus the synced noted hostnames) — clicking
 *  hands the selection to that tab's content script, which opens the
 *  write-note overlay. Request-a-note appears on EVERY OTHER page: the click
 *  itself grants activeTab, so its script injects on demand anywhere. */
async function rebuildMenus(genericHosts: string[]) {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: WRITE_MENU_ID,
    title: "Write a Common Note on this",
    contexts: ["selection"],
    documentUrlPatterns: [...STATIC_TEXT_SITE_PATTERNS, ...genericHosts.map((hostname) => `*://${hostname}/*`)],
  });
  browser.contextMenus.create({
    id: REQUEST_MENU_ID,
    title: "Request a Common Note",
    contexts: ["selection"],
  });
}

export default defineBackground(() => {
  // Sync on install/update and browser start; the hourly alarm keeps
  // long-lived sessions current (the MV3 worker can't hold a timer).
  const startSync = () => {
    browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
    void syncNotedSites();
  };
  browser.runtime.onInstalled.addListener(startSync);
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
