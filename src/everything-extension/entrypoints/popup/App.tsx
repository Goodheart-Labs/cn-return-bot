import { useEffect, useState } from "react";
import { browser } from "#imports";
import { useSession, signOut } from "../../../everything-shared/auth";
import { fetchItemForUrl, fetchNotesForItem, fetchRandomNotedPageUrl, normalizePageUrl, type PageItem } from "../../../everything-shared/notesQuery";
import { resolveReaderCanonical } from "../../utils/readerCanonical";
import { getEnabledOrigins, updateEnabledOrigins } from "../../utils/settings";
import { LoginPanel } from "../../components/LoginPanel";

// Sites injected by the static manifest scripts — no opt-in needed (keep in
// sync with notes.content.ts matches + background.ts STATIC_TEXT_SITES).
const DEFAULT_SITE = /(^|\.)substack\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)ai-2040\.com$/;

const PRIMARY_BUTTON = "w-full bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40";
const SECONDARY_BUTTON = "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100";

type PageState =
  | { kind: "loading" }
  | { kind: "unsupported" } // not http(s)
  | { kind: "no_item"; origin: string }
  | { kind: "item"; origin: string; item: PageItem; noteCount: number };

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function usePageState(): PageState {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  useEffect(() => {
    (async () => {
      const tab = await activeTab();
      const url = tab?.url;
      if (!url || !/^https?:/.test(url)) return setState({ kind: "unsupported" });
      const origin = new URL(url).origin;
      const readerCanonical = await resolveReaderCanonical(url);
      const item = await fetchItemForUrl(normalizePageUrl(readerCanonical ?? url));
      if (!item) return setState({ kind: "no_item", origin });
      const notes = await fetchNotesForItem(item.id);
      setState({ kind: "item", origin, item, noteCount: notes.length });
    })();
  }, []);
  return state;
}

/** Whether this page's content script has already jumped once — decides the
 *  "first" vs "next" button label. An unreachable script (not injected,
 *  orphaned) reads as never-jumped. */
function useJumped(state: PageState): boolean {
  const [jumped, setJumped] = useState(false);
  useEffect(() => {
    if (state.kind !== "item" || state.noteCount === 0) return;
    (async () => {
      const tab = await activeTab();
      if (tab?.id == null) return;
      try {
        const response = await browser.tabs.sendMessage(tab.id, { type: "cn-jump-state" });
        setJumped(!!(response as { jumped?: boolean })?.jumped);
      } catch {
        // no listener in the tab — nothing jumped yet
      }
    })();
  }, [state]);
  return jumped;
}

/** Per-site opt-in for generic text sites: request the host permission, then
 *  register the generic content script for that origin (persists across
 *  restarts). Substack/YouTube are always on via the static manifest.
 *  Only offered when the page actually has notes — asking for a permission
 *  on a site we have nothing to show on is pure noise. Already-enabled
 *  origins still get the disable link so the grant stays revocable. */
function SiteToggle({ origin, hasNotes }: { origin: string; hasNotes: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const hostname = new URL(origin).hostname;
  const scriptId = `cn-generic-${hostname}`;
  const originPattern = `${origin}/*`;

  useEffect(() => {
    browser.scripting.getRegisteredContentScripts({ ids: [scriptId] })
      .then((scripts) => setEnabled(scripts.length > 0))
      .catch(() => setEnabled(false));
  }, [scriptId]);

  const enable = async () => {
    const granted = await browser.permissions.request({ origins: [originPattern] });
    if (!granted) return;
    await browser.scripting.registerContentScripts([{
      id: scriptId,
      matches: [originPattern],
      js: ["/content-scripts/generic.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    }]);
    await updateEnabledOrigins((origins) => [...new Set([...origins, origin])]);
    // Inject into the current tab right away instead of asking for a reload.
    const tab = await activeTab();
    if (tab?.id != null) {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {});
    }
    setEnabled(true);
  };

  const disable = async () => {
    await browser.scripting.unregisterContentScripts({ ids: [scriptId] }).catch(() => {});
    await browser.permissions.remove({ origins: [originPattern] }).catch(() => {});
    await updateEnabledOrigins((origins) => origins.filter((o) => o !== origin));
    setEnabled(false);
  };

  if (enabled === null || (!enabled && !hasNotes)) return null;
  return enabled ? (
    <button onClick={disable} className="text-xs text-gray-500 hover:underline">
      Disable Common Notes on {hostname}
    </button>
  ) : (
    <button onClick={enable} className={PRIMARY_BUTTON}>
      Show notes inline on {hostname}
    </button>
  );
}

/** True when this origin gets our content script (static site or opt-in) —
 *  the heal below must not reload pages we could never answer from. */
async function hasContentScript(origin: string) {
  if (DEFAULT_SITE.test(new URL(origin).hostname)) return true;
  return (await getEnabledOrigins()).includes(origin);
}

const RESEND_ATTEMPTS = 15;
const RESEND_INTERVAL_MS = 400;

/** A tab that predates the last extension reload/update holds an ORPHANED
 *  content script: its DOM (badges) still renders, but its message listener
 *  is cut off from the new extension instance, so sendMessage throws with no
 *  receiver. Heal by reloading the tab and re-sending until the fresh script
 *  answers (it needs a moment to fetch the item and register). */
async function sendJumpToNote(tabId: number) {
  try {
    return await browser.tabs.sendMessage(tabId, { type: "cn-jump-note" });
  } catch {
    await browser.tabs.reload(tabId);
    for (let attempt = 0; attempt < RESEND_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, RESEND_INTERVAL_MS));
      try {
        return await browser.tabs.sendMessage(tabId, { type: "cn-jump-note" });
      } catch {
        // script not up yet — keep trying
      }
    }
  }
}

/** The popup's one action button: jump through this page's notes when it has
 *  any, otherwise open a random page that does. */
function PrimaryAction({ state, jumped }: { state: PageState; jumped: boolean }) {
  const [busy, setBusy] = useState(false);

  if (state.kind === "loading") return <p className="text-sm text-gray-500">Loading notes…</p>;

  if (state.kind === "item" && state.noteCount > 0) {
    const jumpToNote = async () => {
      const tab = await activeTab();
      if (tab?.id != null && (await hasContentScript(state.origin))) {
        await sendJumpToNote(tab.id);
      }
      window.close();
    };
    return (
      <button onClick={jumpToNote} className={PRIMARY_BUTTON}>
        {jumped ? "Jump to next note" : "Jump to first note"}
      </button>
    );
  }

  const openRandomPage = async () => {
    setBusy(true);
    const url = await fetchRandomNotedPageUrl();
    if (url) await browser.tabs.create({ url });
    window.close();
  };
  return (
    <button onClick={openRandomPage} disabled={busy} className={PRIMARY_BUTTON}>
      Open random page
    </button>
  );
}

export function PopupApp() {
  const { session, ready } = useSession();
  const state = usePageState();
  const jumped = useJumped(state);
  const showSiteToggle = (state.kind === "no_item" || state.kind === "item") && !DEFAULT_SITE.test(new URL(state.origin).hostname);

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-[180px]">
      <PrimaryAction state={state} jumped={jumped} />
      {showSiteToggle && <SiteToggle origin={state.origin} hasNotes={state.kind === "item" && state.noteCount > 0} />}

      <div className="border-t border-gray-200 pt-3">
        {!ready ? null : session ? (
          <button onClick={() => signOut()} className={SECONDARY_BUTTON}>Sign out</button>
        ) : (
          <LoginPanel />
        )}
      </div>
    </div>
  );
}
