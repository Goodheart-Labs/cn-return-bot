import { useEffect, useState } from "react";
import { browser } from "#imports";
import { useSession, signOut } from "../../../everything-shared/auth";
import { fetchItemForUrl, fetchNotesForItem, fetchRandomNotedPageUrl, normalizePageUrl, type PageItem } from "../../../everything-shared/notesQuery";
import type { NoteRow } from "../../../everything-shared/types";
import { noteVisible } from "../../utils/claimGroups";
import { resolveReaderCanonical } from "../../utils/readerCanonical";
import { getNoteFilters, updateNoteFilters, type NoteFilters } from "../../utils/settings";
import { STATIC_SITE_HOSTNAME } from "../../utils/staticSites";
import { LoginPanel } from "../../components/LoginPanel";

const PRIMARY_BUTTON = "w-full bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40";
const SECONDARY_BUTTON = "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100";

type PageState =
  | { kind: "loading" }
  | { kind: "unsupported" } // not http(s)
  | { kind: "no_item"; origin: string }
  | { kind: "item"; origin: string; item: PageItem; notes: NoteRow[] };

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
      setState({ kind: "item", origin, item, notes });
    })();
  }, []);
  return state;
}

/** The popup's two tickboxes; writes go to synced storage, which the content
 *  scripts watch to re-render the open pages live. */
function useNoteFilters(): [NoteFilters | null, (patch: Partial<NoteFilters>) => void] {
  const [filters, setFilters] = useState<NoteFilters | null>(null);
  useEffect(() => {
    getNoteFilters().then(setFilters);
  }, []);
  const toggle = (patch: Partial<NoteFilters>) => {
    setFilters((prev) => (prev ? { ...prev, ...patch } : prev));
    void updateNoteFilters(patch);
  };
  return [filters, toggle];
}

function NoteFilterToggles({ filters, onToggle }: { filters: NoteFilters; onToggle: (patch: Partial<NoteFilters>) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={filters.showNeedsRatings}
          onChange={(e) => onToggle({ showNeedsRatings: e.target.checked })}
        />
        Show notes that need more ratings
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={filters.showUnhelpful}
          onChange={(e) => onToggle({ showUnhelpful: e.target.checked })}
        />
        Show unhelpful notes
      </label>
    </div>
  );
}

/** Whether this page's content script has already jumped once — decides the
 *  "first" vs "next" button label. An unreachable script (not injected,
 *  orphaned) reads as never-jumped. */
function useJumped(state: PageState): boolean {
  const [jumped, setJumped] = useState(false);
  useEffect(() => {
    if (state.kind !== "item" || state.notes.length === 0) return;
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

/** True when this origin already gets our content script (static site or a
 *  registration from the background's noted-sites sync) — decides whether
 *  the jump below may heal by reloading, or must inject directly first. */
async function hasContentScript(origin: string) {
  const hostname = new URL(origin).hostname;
  if (STATIC_SITE_HOSTNAME.test(hostname)) return true;
  const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [`cn-generic-${hostname}`] }).catch(() => []);
  return scripts.length > 0;
}

const RESEND_ATTEMPTS = 15;
const RESEND_INTERVAL_MS = 400;

async function retryJumpMessage(tabId: number) {
  for (let attempt = 0; attempt < RESEND_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, RESEND_INTERVAL_MS));
    try {
      return await browser.tabs.sendMessage(tabId, { type: "cn-jump-note" });
    } catch {
      // script not up yet — keep trying
    }
  }
}

/** A tab that predates the last extension reload/update holds an ORPHANED
 *  content script: its DOM (badges) still renders, but its message listener
 *  is cut off from the new extension instance, so sendMessage throws with no
 *  receiver. Heal by reloading the tab (only when a registration would
 *  re-inject on load) and re-sending until the fresh script answers. */
async function sendJumpToNote(tabId: number, scriptWasRegistered: boolean) {
  try {
    return await browser.tabs.sendMessage(tabId, { type: "cn-jump-note" });
  } catch {
    if (scriptWasRegistered) await browser.tabs.reload(tabId);
    return retryJumpMessage(tabId);
  }
}

/** The popup's one action button: jump through this page's visible notes
 *  when it has any, otherwise open a random page that does. */
function PrimaryAction({ state, visibleNoteCount, jumped }: { state: PageState; visibleNoteCount: number; jumped: boolean }) {
  const [busy, setBusy] = useState(false);

  if (state.kind === "loading") return <p className="text-sm text-gray-500">Loading notes…</p>;

  if (state.kind === "item" && visibleNoteCount > 0) {
    const jumpToNote = async () => {
      const tab = await activeTab();
      if (tab?.id != null) {
        // The background's noted-sites sync may not have caught this origin
        // yet — <all_urls> lets us inject directly for this tab meanwhile.
        const registered = await hasContentScript(state.origin);
        if (!registered) {
          await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {});
        }
        await sendJumpToNote(tab.id, registered);
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
  const [filters, toggleFilters] = useNoteFilters();
  const visibleNoteCount = state.kind === "item" && filters
    ? state.notes.filter((note) => noteVisible(note, filters)).length
    : 0;

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-[180px]">
      <PrimaryAction state={state} visibleNoteCount={visibleNoteCount} jumped={jumped} />
      {filters && <NoteFilterToggles filters={filters} onToggle={toggleFilters} />}

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
