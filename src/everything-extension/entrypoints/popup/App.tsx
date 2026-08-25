import { useEffect, useState } from "react";
import { browser } from "#imports";
import { fetchItemForUrl, fetchNotesForItem, fetchRandomNotedPageUrl, isWholePageChecked, type PageItem } from "../../../everything-shared/notesQuery";
import { extractYoutubeVideoId, normalizePageUrl } from "../../../everything-shared/pageUrls";
import { noteStatus } from "../../../everything-shared/noteScore";
import type { NoteRow } from "../../../everything-shared/types";
import { submitNoteRequest } from "../../../everything-shared/noteRequests";
import { authorFeedStatusForTab, type AuthorFeedStatus } from "../../utils/authorFeed";
import { noteVisible, type NoteCounts } from "../../utils/claimGroups";
import { genericScriptId } from "../../utils/genericScript";
import { resolveReaderCanonical } from "../../utils/readerCanonical";
import type { FollowTarget } from "../../utils/followTarget";
import { buildFollowAction, headline } from "../../utils/mountStatusOverlay";
import { isSubstackPostPage, requestMakesSenseForUrl } from "../../utils/followTarget";
import { capturePageFromTab } from "../../utils/pageCapture";
import { addRequestedPage, getRequestedPages } from "../../utils/settings";
import { ActionButton, type StatusAction } from "../../components/StatusOverlay";
import { STATIC_SITE_HOSTNAME } from "../../utils/staticSites";
import { useNoteFilters } from "../../components/NoteFilterToggles";

// Requesting notes makes no sense on these pages. They are searches and
// portals rather than content. Pages that are not http or https are already
// excluded as the "unsupported" kind.
const NON_CONTENT_HOSTNAME = /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)ecosia\.org$|(^|\.)startpage\.com$|(^|\.)search\.brave\.com$/;

const PRIMARY_BUTTON = "w-full bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40";

type PageState =
  | { kind: "loading" }
  | { kind: "unsupported" } // The page is not http or https.
  | { kind: "load_failed" } // The backend could not be reached.
  | { kind: "no_item"; origin: string; pageUrl: string }
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
      // An outage is its own state. Falling through to "no item" would offer
      // to check a page we may well have checked already.
      let item;
      try {
        item = await fetchItemForUrl(normalizePageUrl(readerCanonical ?? url));
      } catch {
        return setState({ kind: "load_failed" });
      }
      if (!item) return setState({ kind: "no_item", origin, pageUrl: normalizePageUrl(readerCanonical ?? url) });
      const notes = await fetchNotesForItem(item.id);
      if (notes === null) return setState({ kind: "load_failed" });
      setState({ kind: "item", origin, item, notes });
    })();
  }, []);
  return state;
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

/** The request button, shown on content pages we have not read in full. On a
 *  page with no item it reads "Request notes on this page"; on a page that
 *  already has an item, because a reader wrote a note or one paragraph was
 *  checked, it reads "Check this whole page" so the two meanings stay apart.
 *  Requested pages are remembered in storage rather than in component state,
 *  so closing and reopening the popup cannot submit the same page twice. */
function RequestNoteButton({ label, doneLabel }: { label: string; doneLabel: string }) {
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
    return <button disabled className={PRIMARY_BUTTON}>{doneLabel}</button>;
  }
  return (
    <>
      <button onClick={request} disabled={phase !== "idle"} className={PRIMARY_BUTTON}>
        {label}
      </button>
      {phase === "error" && <p className="text-sm text-red-600">Could not save the request (try again)</p>}
    </>
  );
}

/** How the current tab's page relates to author feeds, resolved once so the
 *  request and follow buttons can be decided together. Null while resolving;
 *  the caller keeps its loading text up rather than flashing buttons in. */
function useAuthorFeed(state: PageState): AuthorFeedStatus | null {
  const [status, setStatus] = useState<AuthorFeedStatus | null>(null);
  useEffect(() => {
    // The feed is resolved on covered pages too. Following an author must not
    // depend on catching the transient in-page card, so the popup offers it
    // wherever the page has an author, notes or not.
    if (state.kind !== "no_item" && state.kind !== "item") return;
    (async () => {
      const tab = await activeTab();
      setStatus(tab ? await authorFeedStatusForTab(tab) : { kind: "none" });
    })();
  }, [state]);
  return status;
}

/** The popup's version of the status card's follow button. */
function FollowButton({ target }: { target: FollowTarget }) {
  const [action, setAction] = useState<StatusAction | null>(null);
  useEffect(() => {
    void buildFollowAction(target).then(setAction);
  }, [target]);
  if (!action) return null;
  return <ActionButton action={action} buttonClassName={PRIMARY_BUTTON} />;
}

/** The popup for the current page leads with the same status sentence the
 *  in-page card shows: how many notes there are, that we found nothing, or
 *  that the page is unchecked. On a page with notes the sentence itself is
 *  the link that jumps to them, first enabling the site if the sync has not
 *  registered it yet. Blue buttons are kept for actions only: requesting a
 *  check and following an author. Anywhere else the popup opens a random page
 *  that has notes. */
function PrimaryAction({ state, counts, jumped, access }: {
  state: PageState;
  counts: NoteCounts | null;
  jumped: boolean;
  access: PageAccess | null;
}) {
  const [busy, setBusy] = useState(false);
  const authorFeed = useAuthorFeed(state);

  if (state.kind === "loading") return <p className="text-sm text-gray-500">Loading notes…</p>;
  if (state.kind === "load_failed") {
    return <p className="text-sm text-gray-600">Couldn't load notes. Check your connection and try again.</p>;
  }

  const isContentPage =
    (state.kind === "no_item" || state.kind === "item") &&
    !NON_CONTENT_HOSTNAME.test(new URL(state.origin).hostname);

  const openRandomPage = async () => {
    setBusy(true);
    const url = await fetchRandomNotedPageUrl();
    if (url) await browser.tabs.create({ url });
    window.close();
  };

  if (!isContentPage) {
    return (
      <button onClick={openRandomPage} disabled={busy} className={PRIMARY_BUTTON}>
        Open random page
      </button>
    );
  }
  const visibleNoteCount = counts?.visible ?? 0;
  if (!authorFeed || (state.kind === "item" && visibleNoteCount > 0 && !access)) {
    return <p className="text-sm text-gray-500">Loading notes…</p>;
  }

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

  // Only a page the pipeline has read in full stops offering the request. An
  // item that exists because a reader wrote a note, or because one paragraph
  // was checked, still gets the offer, under its own wording. On the
  // platforms whose URL shapes we know, only an actual post or video gets
  // it: a Substack inbox or a YouTube channel page is not checkable. A
  // custom-domain Substack is recognized through its author feed, so its
  // homepage and archive pages are held to the same post rule.
  const pageUrl = state.kind === "item" ? state.item.url : state.pageUrl;
  const substackFeed =
    (authorFeed.kind === "followable" && authorFeed.target.feedType === "substack") ||
    (authorFeed.kind === "followed" && authorFeed.feed.feedType === "substack");
  const postShaped = requestMakesSenseForUrl(pageUrl) && (!substackFeed || isSubstackPostPage(pageUrl));
  const requestable = postShaped && (state.kind === "no_item" || !isWholePageChecked(state.item));
  const fullyCheckedNoNotes = state.kind === "item" && !requestable && visibleNoteCount === 0;

  // The same sentence the in-page card shows, from the same function.
  const noun = state.kind === "item" && extractYoutubeVideoId(state.item.url) ? "video" : "page";
  const statusLine = headline({
    noun,
    counts: state.kind === "item" ? counts : null,
    wholePageChecked: state.kind === "item" && isWholePageChecked(state.item),
  });

  return (
    <div className="space-y-2">
      {visibleNoteCount > 0 ? (
        <button onClick={jumpToNote} className="text-left text-sm text-blue-600 hover:underline" title={jumped ? "Jump to the next note" : "Jump to the first note"}>
          {statusLine}
        </button>
      ) : (
        <p className="text-sm text-gray-600">{statusLine}</p>
      )}
      {requestable &&
        (authorFeed.kind === "followed" ? (
          // A page by an author we already follow needs no request. Every new
          // post gets checked on its own, so the button would only submit
          // noise.
          <p className="text-sm text-gray-600">
            {authorFeed.feed.kind === "youtuber"
              ? "We check every new video from this youtuber."
              : "We check every new post from this author."}
          </p>
        ) : state.kind === "item" ? (
          <RequestNoteButton label="Check this whole page" doneLabel="You asked us to check this whole page" />
        ) : (
          <RequestNoteButton label="Request notes on this page" doneLabel="You requested notes on this page" />
        ))}
      {/* Following an author must not depend on catching the transient in-page
          card, so the popup offers it on covered pages too. */}
      {authorFeed.kind === "followable" && <FollowButton target={authorFeed.target} />}
      {fullyCheckedNoNotes && (
        <button onClick={openRandomPage} disabled={busy} className={PRIMARY_BUTTON}>
          Open random page
        </button>
      )}
    </div>
  );
}

export function PopupApp() {
  const state = usePageState();
  const jumped = useJumped(state);
  const access = usePageAccess(state);
  // The filters are edited on the settings page; the popup only reads them to
  // count the notes the reader would actually see.
  const [filters] = useNoteFilters();
  // A fresh site should reach this session now, not on the next scheduled tick.
  useEffect(() => {
    void browser.runtime.sendMessage({ type: "cn-sync-noted-sites" }).catch(() => {});
  }, []);
  // The same tallies the in-page card shows: the status counts report what
  // exists and ignore the filters, while `visible` is what a jump can reach.
  let counts: NoteCounts | null = null;
  if (state.kind === "item" && filters) {
    counts = { helpful: 0, needsRatings: 0, notHelpful: 0, visible: 0 };
    for (const note of state.notes) {
      const status = noteStatus(note);
      if (status === "helpful") counts.helpful += 1;
      else if (status === "needs_ratings") counts.needsRatings += 1;
      else counts.notHelpful += 1;
      if (noteVisible(note, filters)) counts.visible += 1;
    }
  }

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-[120px]">
      <PrimaryAction state={state} counts={counts} jumped={jumped} access={access} />

      <div className="border-t border-gray-200 pt-3">
        <button
          onClick={() => {
            void browser.runtime.openOptionsPage();
            window.close();
          }}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
