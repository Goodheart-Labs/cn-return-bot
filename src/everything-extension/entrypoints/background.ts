import { defineBackground } from "#imports";
import { browser } from "#imports";
import { fetchCoveredPageUrls, fetchFollowedFeedUrls, fetchNotedPageCounts, fetchReaderCanonical } from "../../everything-shared/notesQuery";
import { submitNoteRequest } from "../../everything-shared/noteRequests";
import { canonicalizePageUrl, isSubstackReaderUrl } from "../../everything-shared/pageUrls";
import { track } from "../../everything-shared/analytics";
import { initBackgroundAnalytics } from "../utils/analytics";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";
import { authorFeedStatusForTab } from "../utils/authorFeed";
import { COVERED_PAGE_URLS_KEY, NOTED_PAGE_STATUS_COUNTS_KEY, getCoveredPageUrls, pageIsCovered } from "../utils/coveredPages";
import { FOLLOWED_FEED_URLS_KEY } from "../utils/followedFeeds";
import { GENERIC_SCRIPT_PREFIX, hostnamePattern, registerGenericScripts, genericScriptId } from "../utils/genericScript";
import { capturePageFromTab } from "../utils/pageCapture";
import { addRequestedPage, getSettingsOnboardingDone, markSettingsOnboardingDone } from "../utils/settings";
import { STATIC_SITE_HOSTNAME } from "../utils/staticSites";

const WRITE_MENU_ID = "cn-write-note";
const REQUEST_MENU_ID = "cn-request-note";
const REQUEST_PAGE_MENU_ID = "cn-request-page";
const BADGE_FEEDBACK_MS = 3000;
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
 *  the list of covered pages and the note counts behind the listing badges.
 *  The content scripts use both for their on-device checks. */
async function syncNotedSites() {
  try {
    const [urls, counts, followedFeeds] = await Promise.all([
      fetchCoveredPageUrls(),
      fetchNotedPageCounts(),
      fetchFollowedFeedUrls(),
    ]);
    // The listing badges and count cards draw their per-page note counts from
    // this cache.
    if (counts) await browser.storage.local.set({ [NOTED_PAGE_STATUS_COUNTS_KEY]: counts });
    // The follow-button surfaces hide the button for feeds on this list.
    if (followedFeeds) await browser.storage.local.set({ [FOLLOWED_FEED_URLS_KEY]: followedFeeds });
    if (urls) {
      await browser.storage.local.set({ [COVERED_PAGE_URLS_KEY]: urls });
      const wanted = new Set(genericHostnames(urls));
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
  browser.contextMenus.create({
    id: REQUEST_MENU_ID,
    title: "Request Common Notes on this",
    contexts: ["selection"],
  });
  // The page-context item is the always-available request path, now that the
  // in-page request overlay is off by default. Browsers show page items on a
  // plain right-click and selection items only over a selection, so the two
  // request entries never appear together.
  browser.contextMenus.create({
    id: REQUEST_PAGE_MENU_ID,
    title: "Request Common Notes on this page",
    contexts: ["page"],
  });
}

/** A context-menu click has no page of its own to answer on, so the action
 *  badge is the feedback: a tick when the request was saved, an exclamation
 *  mark when it failed. */
function flashBadge(tabId: number | undefined, text: string) {
  const action = browser.action ?? (browser as unknown as { browserAction?: typeof browser.action }).browserAction;
  action?.setBadgeText({ text, tabId }).catch(() => {});
  setTimeout(() => action?.setBadgeText({ text: "", tabId }).catch(() => {}), BADGE_FEEDBACK_MS);
}

/** Delivers a message to the tab's content script. On a page where no script
 *  runs yet, the click's activeTab grant lets us inject the generic one on
 *  demand; the script needs a moment to mount before its listener answers,
 *  which is why we retry. Returns false when nothing could be reached, which
 *  only happens on restricted pages such as chrome:// and the Web Store. */
async function sendToTabWithInjection(tabId: number, message: unknown): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/generic.js"] });
    } catch {
      return false;
    }
    for (let attempt = 0; attempt < INJECT_RETRY_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, INJECT_RETRY_DELAY_MS));
      try {
        await browser.tabs.sendMessage(tabId, message);
        return true;
      } catch {
        // The listener is not up yet, so we try again.
      }
    }
    return false;
  }
}

/** Tells the user in the page why their request was not needed. Falls back to
 *  the toolbar tick when the page cannot host the card: the request's goal is
 *  met either way. */
async function showRequestNotNeeded(tab: { id?: number }, headline: string) {
  const delivered = tab.id != null && (await sendToTabWithInjection(tab.id, { type: "cn-request-info", headline }));
  if (!delivered) flashBadge(tab.id, "✓");
}

/** Submits a note request for the selected paragraph. The menu click grants
 *  activeTab, so the page's canonical link and body text can be read even on a
 *  site the user never enabled; the pipeline fact-checks the page from that
 *  text. A restricted page falls back to the tab's url and title alone. A page
 *  that is already checked, or whose author we already follow, submits nothing
 *  and gets an explanatory card instead. */
async function requestNoteOnSelection(tab: { id?: number; url?: string; title?: string }, selection: string) {
  const captured = tab.id != null ? await capturePageFromTab(tab.id) : null;
  const href = captured?.href ?? tab.url;
  if (!href) return;
  // A Substack reader page hides the publication's own post URL behind a
  // fetch, the same way the notes flow resolves it.
  const readerCanonical = isSubstackReaderUrl(href) ? await fetchReaderCanonical(href) : null;
  const pageUrl = readerCanonical
    ? canonicalizePageUrl(readerCanonical, null)
    : canonicalizePageUrl(href, captured?.canonical ?? null);
  const covered = await getCoveredPageUrls();
  if (covered && pageIsCovered(pageUrl, covered)) {
    await showRequestNotNeeded(tab, "This page has already been checked.");
    return;
  }
  const authorFeed = await authorFeedStatusForTab(tab);
  if (authorFeed.kind === "followed") {
    const what = authorFeed.feed.kind === "youtuber" ? "video from this youtuber" : "post from this author";
    await showRequestNotNeeded(tab, `We already check every new ${what}.`);
    return;
  }
  try {
    await submitNoteRequest({
      pageUrl,
      pageTitle: captured?.title ?? tab.title ?? "",
      selection: selection.trim() || null,
      pageText: captured?.text,
    });
    // This is only a local reminder. The request itself is already saved.
    await addRequestedPage(pageUrl).catch(() => {});
    flashBadge(tab.id, "✓");
  } catch (err) {
    console.warn("[common-notes] note request failed:", err);
    flashBadge(tab.id, "!");
  }
}

export default defineBackground(() => {
  initBackgroundAnalytics();
  // The 5-minute alarm keeps long-lived sessions current (the MV3 worker
  // can't hold a timer), and the popup pings cn-sync-noted-sites on open.
  // The alarm is checked at every worker boot instead of on install/startup
  // events: Chrome clears alarms exactly when the extension is installed,
  // updated, or reloaded, and a reload via chrome.runtime.reload() (the
  // dev-reload hook) fires neither lifecycle event — relying on them left
  // the covered-pages cache frozen until a browser restart. On a normal
  // worker wake the alarm still exists and this does nothing.
  void browser.alarms.get(SYNC_ALARM).then((existing) => {
    if (existing) return;
    browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
    void syncNotedSites();
  });
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") track("extension_installed");
    void createMenus();
    // The settings onboarding: open the settings page once, so the user has
    // seen the visit-recording checkboxes before anything is recorded (the
    // recording code is inert until this flag is set). The flag is set before
    // the tab opens, so a failed open cannot re-open the page on every update.
    if (details.reason === "install" || details.reason === "update") {
      void (async () => {
        if (await getSettingsOnboardingDone()) return;
        await markSettingsOnboardingDone();
        await browser.runtime.openOptionsPage();
      })();
    }
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncNotedSites();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if ((info.menuItemId === REQUEST_MENU_ID || info.menuItemId === REQUEST_PAGE_MENU_ID) && tab != null) {
      void requestNoteOnSelection(tab, info.selectionText ?? "");
      return;
    }
    if (info.menuItemId === WRITE_MENU_ID && tab?.id != null) {
      void sendToTabWithInjection(tab.id, { type: "cn-write-note", selection: info.selectionText ?? "" });
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
      // Resolves a Substack reader URL to the publication's own post URL. The
      // notes mount and the coverage badges both use this. The fetch has to run
      // here in the background, where our *.substack.com host permission
      // applies; a content script's fetch is bound by CORS and may neither
      // follow the cross-origin redirect nor read the response.
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
