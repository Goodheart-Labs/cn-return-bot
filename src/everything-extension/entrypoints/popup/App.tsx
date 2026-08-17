import { useEffect, useState } from "react";
import { browser } from "#imports";
import { useSession, signOut } from "../../../everything-shared/auth";
import { fetchItemForUrl, fetchNotesForItem, fetchRandomNotedPageUrl, type PageItem } from "../../../everything-shared/notesQuery";
import { normalizePageUrl } from "../../../everything-shared/pageUrls";
import type { NoteRow } from "../../../everything-shared/types";
import { submitNoteRequest } from "../../../everything-shared/noteRequests";
import { noteVisible } from "../../utils/claimGroups";
import { genericScriptId } from "../../utils/genericScript";
import { resolveReaderCanonical } from "../../utils/readerCanonical";
import { capturePageFromTab } from "../../utils/pageCapture";
import { addRequestedPage, getNoteFilters, getRequestedPages, updateNoteFilters, type NoteFilters } from "../../utils/settings";
import { STATIC_SITE_HOSTNAME } from "../../utils/staticSites";
import { LoginPanel } from "../../components/LoginPanel";

// Requesting notes makes no sense on these pages. They are searches and
// portals rather than content. Pages that are not http or https are already
// excluded as the "unsupported" kind.
const NON_CONTENT_HOSTNAME = /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)ecosia\.org$|(^|\.)startpage\.com$|(^|\.)search\.brave\.com$/;

const PRIMARY_BUTTON = "w-full bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40";
const SECONDARY_BUTTON = "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100";

type PageState =
  | { kind: "loading" }
  | { kind: "unsupported" } // The page is not http or https.
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

/** The popup's two tickboxes. A change is written to synced storage, and the
 *  content scripts watch that storage so open pages re-render straight
 *  away. */
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

/** Whether this page's content script has already jumped to a note once. This
 *  decides whether the button says "first" or "next". A script we cannot
 *  reach, because it was never injected or because it is orphaned, counts as
 *  never having jumped. */
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
        // There is no listener in the tab, so nothing has jumped yet.
      }
    })();
  }, [state]);
  return jumped;
}

/** How notes stand on this page's site. "on" means the content script is
 *  guaranteed to be there, either through the static manifest or through a
 *  registration. "syncing" means the site is covered but the background's
 *  sync has not registered it yet, so the jump button injects into the tab
 *  directly. */
type PageAccess = "on" | "syncing";

function usePageAccess(state: PageState): PageAccess | null {
  const [access, setAccess] = useState<PageAccess | null>(null);
  useEffect(() => {
    if (state.kind !== "item") return;
    const hostname = new URL(state.origin).hostname;
    if (STATIC_SITE_HOSTNAME.test(hostname)) return setAccess("on");
    (async () => {
      const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [genericScriptId(hostname)] }).catch(() => []);
      setAccess(scripts.length > 0 ? "on" : "syncing");
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
      // The script is not up yet, so we try again.
    }
  }
}

/** A tab that was open before the last extension reload or update still holds
 *  an orphaned content script. Its DOM, the badges included, still renders,
 *  but its message listener is cut off from the new extension instance, so
 *  sendMessage throws because there is no receiver. We heal that by reloading
 *  the tab and re-sending until the fresh script answers. We only reload when
 *  a registration exists to re-inject the script on load. */
async function sendJumpToNote(tabId: number, scriptWasRegistered: boolean) {
  try {
    return await browser.tabs.sendMessage(tabId, { type: "cn-jump-note" });
  } catch {
    if (scriptWasRegistered) await browser.tabs.reload(tabId);
    return retryJumpMessage(tabId);
  }
}

/** The "Request notes on this page" button, shown on uncovered content pages.
 *  It works on the whole page and replaced an older flow that requested notes
 *  on a text selection. Requested pages are remembered in storage rather than
 *  in component state, so closing and reopening the popup cannot submit the
 *  same page twice. */
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
      // Opening the popup granted activeTab, so we can read the page's body
      // text. The pipeline fact-checks the page from that text, because it
      // cannot fetch arbitrary pages itself. A page we may not inject into
      // still gets a text-less request.
      const captured = tab.id != null ? await capturePageFromTab(tab.id) : null;
      await submitNoteRequest({ pageUrl, pageTitle: tab.title ?? "", selection: null, pageText: captured?.text });
      // This is only a local reminder. The request itself is already saved.
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

/** The popup's single action button. On a page with visible notes it jumps to
 *  them, first enabling the site if the user never granted it. On an uncovered
 *  content page it requests notes. Anywhere else it opens a random page that
 *  has notes. */
function PrimaryAction({ state, visibleNoteCount, jumped, access }: {
  state: PageState;
  visibleNoteCount: number;
  jumped: boolean;
  access: PageAccess | null;
}) {
  const [busy, setBusy] = useState(false);

  if (state.kind === "loading") return <p className="text-sm text-gray-500">Loading notes…</p>;

  if (state.kind === "item" && visibleNoteCount > 0) {
    if (!access) return <p className="text-sm text-gray-500">Loading notes…</p>;

    const jumpToNote = async () => {
      const tab = await activeTab();
      if (tab?.id != null) {
        if (access === "syncing") {
          // The site is covered but the sync has not registered it yet, so we
          // inject into this tab directly. Healing can only retry here. A
          // reload would land on a page with no script, because nothing is
          // registered that would re-inject it.
          await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/generic.js"] }).catch(() => {});
        }
        await sendJumpToNote(tab.id, access === "on");
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
