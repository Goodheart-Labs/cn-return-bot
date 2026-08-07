import { useEffect, useState } from "react";
import { browser } from "#imports";
import { useSession, signOut } from "../../../everything-shared/auth";
import { fetchItemForUrl, fetchNotesForItem, fetchRandomNotedPageUrl, normalizePageUrl, type PageItem } from "../../../everything-shared/notesQuery";
import type { NoteRow } from "../../../everything-shared/types";
import { submitNoteRequest } from "../../../everything-shared/noteRequests";
import { noteVisible } from "../../utils/claimGroups";
import { genericScriptId, hostnamePattern, registerGenericScripts } from "../../utils/genericScript";
import { resolveReaderCanonical } from "../../utils/readerCanonical";
import { addRequestedPage, getNoteFilters, getRequestedPages, removeDismissedGrantHost, updateNoteFilters, type NoteFilters } from "../../utils/settings";
import { STATIC_SITE_HOSTNAME } from "../../utils/staticSites";
import { LoginPanel } from "../../components/LoginPanel";

// Pages where "request notes" makes no sense — searches and portals, not
// content (non-http pages are already excluded as kind "unsupported").
const NON_CONTENT_HOSTNAME = /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)ecosia\.org$|(^|\.)startpage\.com$|(^|\.)search\.brave\.com$/;

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

/** How this page's origin stands with the extension: script guaranteed
 *  (static/registered), injectable without asking (granted), or needing the
 *  user's grant (ungranted — redirect mode only; all-urls installs always
 *  read as granted). Precomputed so the enable button can call
 *  permissions.request FIRST in its click handler — an await before it can
 *  void the user gesture the API requires. */
type PageAccess = "static" | "registered" | "granted" | "ungranted";

function usePageAccess(state: PageState): PageAccess | null {
  const [access, setAccess] = useState<PageAccess | null>(null);
  useEffect(() => {
    if (state.kind !== "item") return;
    const hostname = new URL(state.origin).hostname;
    if (STATIC_SITE_HOSTNAME.test(hostname)) return setAccess("static");
    (async () => {
      const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [genericScriptId(hostname)] }).catch(() => []);
      if (scripts.length > 0) return setAccess("registered");
      const granted = await browser.permissions.contains({ origins: [hostnamePattern(hostname)] }).catch(() => false);
      setAccess(granted ? "granted" : "ungranted");
    })();
  }, [state]);
  return access;
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

/** "Request notes on this page" for uncovered content pages — the page-level
 *  successor of the old text-selection request flow. Requested pages are
 *  remembered (storage, not component state) so closing and reopening the
 *  popup can't submit the same page twice. */
function RequestNoteButton() {
  const [phase, setPhase] = useState<"loading" | "idle" | "busy" | "done" | "error">("loading");

  useEffect(() => {
    (async () => {
      const tab = await activeTab();
      if (!tab?.url) return;
      setPhase((await getRequestedPages()).includes(normalizePageUrl(tab.url)) ? "done" : "idle");
    })();
  }, []);

  const request = async () => {
    setPhase("busy");
    try {
      const tab = await activeTab();
      if (!tab?.url) throw new Error("no page");
      const pageUrl = normalizePageUrl(tab.url);
      await submitNoteRequest({ pageUrl, pageTitle: tab.title ?? "", selection: null });
      // Best-effort memory — the request itself is already saved.
      await addRequestedPage(pageUrl).catch(() => {});
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  if (phase === "done") {
    return <button disabled className={PRIMARY_BUTTON}>You requested notes on this page</button>;
  }
  return (
    <>
      <button onClick={request} disabled={phase !== "idle"} className={PRIMARY_BUTTON}>
        Request notes on this page
      </button>
      {phase === "error" && <p className="text-sm text-red-600">Could not save the request (try again)</p>}
    </>
  );
}

/** The popup's one action button: on a page with visible notes, jump to them
 *  (enabling the site first when the user never granted it); on an uncovered
 *  content page, request notes; anywhere else, open a random noted page. */
function PrimaryAction({ state, visibleNoteCount, jumped, access }: {
  state: PageState;
  visibleNoteCount: number;
  jumped: boolean;
  access: PageAccess | null;
}) {
  const [busy, setBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  if (state.kind === "loading") return <p className="text-sm text-gray-500">Loading notes…</p>;

  if (state.kind === "item" && visibleNoteCount > 0) {
    if (!access) return <p className="text-sm text-gray-500">Loading notes…</p>;

    if (access === "ungranted") {
      const enable = async () => {
        setEnableError(null);
        const hostname = new URL(state.origin).hostname;
        try {
          // permissions.request comes FIRST — the click is its user gesture.
          // A rejection is a real bug (e.g. missing optional permissions in
          // the manifest), not a user choice — show it, don't swallow it.
          const granted = await browser.permissions.request({ origins: [hostnamePattern(hostname)] });
          if (!granted) return;
        } catch (err) {
          return setEnableError((err as Error).message);
        }
        await registerGenericScripts([hostname]);
        await removeDismissedGrantHost(hostname);
        const tab = await activeTab();
        if (tab?.id != null) {
          await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {});
        }
        window.close();
      };
      return (
        <>
          <button onClick={enable} className={PRIMARY_BUTTON}>
            Show notes on this site
          </button>
          {enableError && <p className="text-sm text-red-600">{enableError}</p>}
        </>
      );
    }

    const jumpToNote = async () => {
      const tab = await activeTab();
      if (tab?.id != null) {
        if (access === "granted") {
          // Consent given but the sync hasn't registered this origin yet —
          // bridge directly for this tab. Retry-only heal: a reload would
          // land scriptless (nothing registered to re-inject).
          await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {});
        }
        await sendJumpToNote(tab.id, access !== "granted");
      }
      window.close();
    };
    return (
      <button onClick={jumpToNote} className={PRIMARY_BUTTON}>
        {jumped ? "Jump to next note" : "Jump to first note"}
      </button>
    );
  }

  if (state.kind === "no_item" && !NON_CONTENT_HOSTNAME.test(new URL(state.origin).hostname)) {
    return <RequestNoteButton />;
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
  const access = usePageAccess(state);
  const [filters, toggleFilters] = useNoteFilters();
  // A fresh site should reach this session now, not on the next scheduled tick.
  useEffect(() => {
    void browser.runtime.sendMessage({ type: "cn-sync-noted-sites" }).catch(() => {});
  }, []);
  const visibleNoteCount = state.kind === "item" && filters
    ? state.notes.filter((note) => noteVisible(note, filters)).length
    : 0;

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-[180px]">
      <PrimaryAction state={state} visibleNoteCount={visibleNoteCount} jumped={jumped} access={access} />
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
