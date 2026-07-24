import { useEffect, useState } from "react";
import { browser } from "#imports";
import { useSession, signOut } from "../../../everything-shared/auth";
import { displayName } from "../../../everything-shared/session";
import { fetchItemForUrl, fetchNotesForItem, fetchReaderCanonical, isSubstackReaderUrl, normalizePageUrl, type PageItem } from "../../../everything-shared/notesQuery";
import { COMMONNOTES_ORIGIN } from "../../utils/share";
import { getEnabledOrigins, updateEnabledOrigins } from "../../utils/settings";
import { LoginPanel } from "../../components/LoginPanel";

// Sites injected by the static manifest scripts — no opt-in needed.
const DEFAULT_SITE = /(^|\.)substack\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/;

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
      const readerCanonical = isSubstackReaderUrl(url) ? await fetchReaderCanonical(url) : null;
      const item = await fetchItemForUrl(normalizePageUrl(readerCanonical ?? url));
      if (!item) return setState({ kind: "no_item", origin });
      const notes = await fetchNotesForItem(item.id);
      setState({ kind: "item", origin, item, noteCount: notes.length });
    })();
  }, []);
  return state;
}

/** Per-site opt-in for generic text sites: request the host permission, then
 *  register the generic content script for that origin (persists across
 *  restarts). Substack/YouTube are always on via the static manifest. */
function SiteToggle({ origin }: { origin: string }) {
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

  if (enabled === null) return null;
  return enabled ? (
    <button onClick={disable} className="text-xs text-gray-500 hover:underline">
      Disable Common Notes on {hostname}
    </button>
  ) : (
    <button onClick={enable} className="w-full bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700">
      Enable Common Notes on {hostname}
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
async function sendScrollToNotes(tabId: number) {
  try {
    return await browser.tabs.sendMessage(tabId, { type: "cn-scroll-to-notes" });
  } catch {
    await browser.tabs.reload(tabId);
    for (let attempt = 0; attempt < RESEND_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, RESEND_INTERVAL_MS));
      try {
        return await browser.tabs.sendMessage(tabId, { type: "cn-scroll-to-notes" });
      } catch {
        // script not up yet — keep trying
      }
    }
  }
}

function PageSection({ state }: { state: PageState }) {
  const scrollToNotes = async () => {
    const tab = await activeTab();
    if (tab?.id != null && state.kind === "item" && (await hasContentScript(state.origin))) {
      await sendScrollToNotes(tab.id);
    }
    window.close();
  };

  switch (state.kind) {
    case "loading":
      return <p className="text-sm text-gray-500">Loading notes…</p>;
    case "unsupported":
      return <p className="text-sm text-gray-500">Common Notes runs on regular web pages.</p>;
    case "no_item":
      return <p className="text-sm text-gray-500">No notes on this page yet.</p>;
    case "item":
      return (
        <button onClick={scrollToNotes} className="text-sm text-blue-600 hover:underline">
          {state.noteCount} {state.noteCount === 1 ? "note" : "notes"} on this page
        </button>
      );
  }
}

export function PopupApp() {
  const { session, ready } = useSession();
  const state = usePageState();
  const showSiteToggle = (state.kind === "no_item" || state.kind === "item") && !DEFAULT_SITE.test(new URL(state.origin).hostname);

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-[180px]">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-extrabold text-gray-900">Common Notes</h1>
        <a href={COMMONNOTES_ORIGIN} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
          commonnotes.net
        </a>
      </div>

      <PageSection state={state} />
      {showSiteToggle && <SiteToggle origin={state.origin} />}

      <div className="border-t border-gray-200 pt-3">
        {!ready ? null : session ? (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span className="truncate" title={displayName(session)}>{displayName(session)}</span>
            <button onClick={() => signOut()} className="text-blue-600 hover:underline">Sign out</button>
          </div>
        ) : (
          <LoginPanel />
        )}
      </div>
    </div>
  );
}
