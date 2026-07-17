import { useEffect, useState } from "react";
import { browser } from "#imports";
import { useSession, signOut } from "../../../everything-shared/auth";
import { displayName } from "../../../everything-shared/session";
import { fetchItemForUrl, fetchNotesForItem, normalizePageUrl, type PageItem } from "../../../everything-shared/notesQuery";
import { COMMONNOTES_ORIGIN } from "../../utils/share";
import { LoginPanel } from "../../components/LoginPanel";

const ENABLED_ORIGINS_KEY = "cn:enabledOrigins";
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
      const item = await fetchItemForUrl(normalizePageUrl(url));
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

  const rememberOrigins = async (mutate: (origins: string[]) => string[]) => {
    const stored = (await browser.storage.sync.get(ENABLED_ORIGINS_KEY))[ENABLED_ORIGINS_KEY] as string[] | undefined;
    await browser.storage.sync.set({ [ENABLED_ORIGINS_KEY]: mutate(stored ?? []) });
  };

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
    await rememberOrigins((origins) => [...new Set([...origins, origin])]);
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
    await rememberOrigins((origins) => origins.filter((o) => o !== origin));
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

function PageSection({ state }: { state: PageState }) {
  const scrollToNotes = async () => {
    const tab = await activeTab();
    if (tab?.id != null) await browser.tabs.sendMessage(tab.id, { type: "cn-scroll-to-notes" }).catch(() => {});
    window.close();
  };

  switch (state.kind) {
    case "loading":
      return <p className="text-sm text-gray-500">Checking this page…</p>;
    case "unsupported":
      return <p className="text-sm text-gray-500">Common Notes runs on regular web pages.</p>;
    case "no_item":
      return <p className="text-sm text-gray-500">No community notes for this page yet.</p>;
    case "item":
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-800 truncate" title={state.item.title ?? undefined}>
            {state.item.title ?? state.item.url}
          </p>
          <button onClick={scrollToNotes} className="text-sm text-blue-600 hover:underline">
            {state.noteCount} {state.noteCount === 1 ? "note" : "notes"} on this page — show me
          </button>
        </div>
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
