import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { browser } from "#imports";
import { fetchItemForUrl, isWholePageChecked, type PageItem } from "@cn/core/items";
import { fetchNotesForItem } from "@cn/core/notes";
import { COMMONNOTES_ORIGIN, extractYoutubeVideoId, isSubstackPostPage, normalizePageUrl } from "@cn/core/pageUrls";
import type { NoteRow } from "@cn/core/types";
import { submitNoteRequest } from "@cn/core/noteRequests";
import { progressIsTerminal, progressLines } from "@cn/core/requestProgress";
import { authorFeedStatusForTab, type AuthorFeedStatus } from "../../utils/authorFeed";
import { getLiveRequest, removeLiveRequest, saveLiveRequest, type LiveRequest } from "../../utils/liveRequests";
import { fetchProgressSnapshot } from "../../utils/requestProgressController";
import { noteCounts, type NoteCounts } from "../../utils/claimGroups";
import { genericScriptId } from "../../utils/genericScript";
import { resolveReaderCanonical } from "../../utils/readerCanonical";
import { priorityActiveLabel, type CreatorTarget } from "../../utils/creatorTarget";
import { buildPriorityAction, headline } from "../../utils/pageStatus";
import { requestMakesSenseForUrl } from "../../utils/pageShape";
import { capturePageFromTab } from "../../utils/pageCapture";
import { addRequestedPage, getRequestedPages } from "../../utils/settings";
import { ActionButton, type StatusAction } from "../../components/ActionButton";
import { Button, buttonVariants } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { STATIC_SITE_HOSTNAME } from "../../utils/staticSites";
import { BOOK_CALL_URLS, FEEDBACK_FORM_URL } from "../../utils/feedbackLinks";
import { useNoteDisplay } from "../../components/NoteDisplayChoices";

// Requesting notes makes no sense on these pages. They are searches and
// portals rather than content. Pages that are not http or https are already
// excluded as the "unsupported" kind.
const NON_CONTENT_HOSTNAME = /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)ecosia\.org$|(^|\.)startpage\.com$|(^|\.)search\.brave\.com$/;

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

/** What the popup knows about the active tab's page. An outage is its own
 *  state. Falling through to "no item" would offer to check a page we may
 *  well have checked already. */
async function loadPageState(): Promise<PageState> {
  const tab = await activeTab();
  const url = tab?.url;
  if (!url || !/^https?:/.test(url)) return { kind: "unsupported" };
  const origin = new URL(url).origin;
  const pageUrl = normalizePageUrl((await resolveReaderCanonical(url)) ?? url);
  try {
    const item = await fetchItemForUrl(pageUrl);
    if (!item) return { kind: "no_item", origin, pageUrl };
    return { kind: "item", origin, item, notes: await fetchNotesForItem(item.id) };
  } catch {
    return { kind: "load_failed" };
  }
}

const usePageState = (): PageState =>
  useQuery({ queryKey: ["popupPage"], queryFn: loadPageState }).data ?? { kind: "loading" };

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

async function loadPageAccess(origin: string): Promise<PageAccess> {
  const hostname = new URL(origin).hostname;
  if (STATIC_SITE_HOSTNAME.test(hostname)) return "on";
  const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [genericScriptId(hostname)] }).catch(() => []);
  return scripts.length > 0 ? "on" : "syncing";
}

function usePageAccess(state: PageState): PageAccess | null {
  const origin = state.kind === "item" ? state.origin : null;
  return useQuery({ queryKey: ["pageAccess", origin], queryFn: () => loadPageAccess(origin!), enabled: !!origin }).data ?? null;
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
 *  checked, it reads "Check this page" so the two meanings stay apart.
 *  Requested pages are remembered in storage rather than in component state,
 *  so closing and reopening the popup cannot submit the same page twice. */
function RequestNoteButton({ label, doneLabel, creatorFeedUrl, onLive }: {
  label: string;
  doneLabel: string;
  /** The page's creator, so the pipeline files the page under their project. */
  creatorFeedUrl: string | null;
  onLive: (entry: LiveRequest) => void;
}) {
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
      const token = await submitNoteRequest({ pageUrl, pageTitle: tab.title ?? "", selection: null, pageText: captured?.text, creatorFeedUrl });
      // This is only a local reminder. The request itself is already saved.
      await addRequestedPage(pageUrl).catch(() => {});
      // The token is the handle for live progress. Storing the entry is what
      // survives closing the popup, and the background starts the in-page
      // card because only it can inject the content script when none runs.
      if (token) {
        const entry: LiveRequest = { pageUrl, token, requestedAt: Date.now() };
        await saveLiveRequest(entry).catch(() => {});
        if (tab.id != null) {
          void browser.runtime.sendMessage({ type: "cn-request-live-forward", tabId: tab.id, pageUrl, token }).catch(() => {});
        }
        onLive(entry);
      }
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  if (phase === "done") {
    return <Button disabled className="w-full">{doneLabel}</Button>;
  }
  return (
    <>
      <Button className="w-full" onClick={request} disabled={phase !== "idle"}>
        {label}
      </Button>
      {phase === "error" && <p className="text-sm text-negative">Could not save the request (try again)</p>}
    </>
  );
}

/** How often the popup rereads a live request's state. The popup lives for
 *  seconds, so an interval of narrow fetches replaces a realtime channel. */
const LIVE_LINE_REFRESH_MS = 5_000;

/** The current page's live note request, if this device has one. Loaded from
 *  storage, and swapped in directly when the request button submits. The
 *  stored key can be the item's canonical URL or the tab URL, depending on
 *  which surface submitted, so both are tried. */
function useLiveRequest(state: PageState): [LiveRequest | null, (entry: LiveRequest) => void] {
  const [entry, setEntry] = useState<LiveRequest | null>(null);
  useEffect(() => {
    if (state.kind !== "no_item" && state.kind !== "item") return;
    (async () => {
      const tab = await activeTab();
      const candidates = [
        state.kind === "item" ? state.item.url : state.pageUrl,
        ...(tab?.url ? [normalizePageUrl(tab.url)] : []),
      ];
      for (const url of candidates) {
        const stored = await getLiveRequest(url);
        if (stored) return setEntry(stored);
      }
    })();
  }, [state]);
  return [entry, setEntry];
}

/** The same terse readout the in-page card shows, one fact per line, rendered
 *  while the popup is open. */
function LiveRequestLine({ entry }: { entry: LiveRequest }) {
  // Polled while the popup is open, and no longer once the request reached a
  // final state. The first answer that names the item is saved on the stored
  // request, so the next popup skips the lookup; a final answer forgets the
  // request.
  const progress = useQuery({
    queryKey: ["liveRequest", entry.token],
    queryFn: async () => {
      const snapshot = await fetchProgressSnapshot({ token: entry.token, itemId: entry.itemId });
      if (snapshot.itemId && !entry.itemId) void saveLiveRequest({ ...entry, itemId: snapshot.itemId }).catch(() => {});
      if (progressIsTerminal(snapshot.progress)) void removeLiveRequest(entry.pageUrl).catch(() => {});
      return snapshot.progress;
    },
    refetchInterval: (query) => (query.state.data && progressIsTerminal(query.state.data) ? false : LIVE_LINE_REFRESH_MS),
  }).data ?? { kind: "saved" };
  return (
    <div className="text-sm text-fg-secondary">
      {progressLines(progress).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
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
function PriorityButton({ target }: { target: CreatorTarget }) {
  const [action, setAction] = useState<StatusAction | null>(null);
  useEffect(() => {
    void buildPriorityAction(target).then(setAction);
  }, [target]);
  if (!action) return null;
  return <ActionButton action={action} />;
}

/** The popup for the current page leads with a status sentence: how many
 *  notes there are, that we found nothing, or that the page is unchecked. On a page with notes the sentence itself is
 *  the link that jumps to them, first enabling the site if the sync has not
 *  registered it yet. Blue buttons are kept for actions only: requesting a
 *  check and following an author. */
function PrimaryAction({ state, counts, jumped, access }: {
  state: PageState;
  counts: NoteCounts | null;
  jumped: boolean;
  access: PageAccess | null;
}) {
  const authorFeed = useAuthorFeed(state);
  const [liveEntry, setLiveEntry] = useLiveRequest(state);

  if (state.kind === "loading") return <p className="text-sm text-fg-muted">Loading notes…</p>;
  if (state.kind === "load_failed") {
    return <p className="text-sm text-fg-secondary">Couldn't load notes. Check your connection and try again.</p>;
  }

  const isContentPage =
    (state.kind === "no_item" || state.kind === "item") &&
    !NON_CONTENT_HOSTNAME.test(new URL(state.origin).hostname);

  if (!isContentPage) {
    return (
      <p className="text-sm text-fg-secondary">
        Open a post or video on a covered site to see Common Notes. You can also see notes on{" "}
        <a href={`${COMMONNOTES_ORIGIN}/notes`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "link" })}>
          commonnotes.net/notes
        </a>
        .
      </p>
    );
  }
  const visibleNoteCount = counts?.visible ?? 0;
  if (!authorFeed || (state.kind === "item" && visibleNoteCount > 0 && !access)) {
    return <p className="text-sm text-fg-muted">Loading notes…</p>;
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
    (authorFeed.kind === "pressable" && authorFeed.target.feedType === "substack") ||
    (authorFeed.kind === "prioritized" && authorFeed.feed.feedType === "substack");
  const postShaped = requestMakesSenseForUrl(pageUrl) && (!substackFeed || isSubstackPostPage(pageUrl));
  const requestable = postShaped && (state.kind === "no_item" || !isWholePageChecked(state.item));
  const creatorFeedUrl = authorFeed.kind === "pressable" ? authorFeed.target.feedUrl : null;

  const noun = state.kind === "item" && extractYoutubeVideoId(state.item.url) ? "video" : "page";
  const statusLine = headline({
    noun,
    counts: state.kind === "item" ? counts : null,
    wholePageChecked: state.kind === "item" && isWholePageChecked(state.item),
  });

  return (
    <div className="space-y-2">
      {visibleNoteCount > 0 ? (
        <Button variant="link" className="text-left text-sm font-medium" onClick={jumpToNote} title={visibleNoteCount === 1 ? "Jump to the note" : jumped ? "Jump to the next note" : "Jump to the first note"}>
          {statusLine}
        </Button>
      ) : (
        <p className="text-sm font-medium text-fg">{statusLine}</p>
      )}
      {liveEntry && <LiveRequestLine entry={liveEntry} />}
      {requestable &&
        (authorFeed.kind === "prioritized" ? (
          // A page by a creator whose week is already running needs no press.
          // Every new post gets checked on its own, so the button would only
          // submit noise.
          <p className="text-sm text-fg-secondary">{priorityActiveLabel(authorFeed.feed.kind)}</p>
        ) : state.kind === "item" ? (
          <RequestNoteButton label="Check this page" doneLabel="You asked us to check this page" creatorFeedUrl={creatorFeedUrl} onLive={setLiveEntry} />
        ) : (
          <RequestNoteButton label="Request notes on this page" doneLabel="You requested notes on this page" creatorFeedUrl={creatorFeedUrl} onLive={setLiveEntry} />
        ))}
      {/* The popup offers the press on covered pages too. */}
      {authorFeed.kind === "pressable" && <PriorityButton target={authorFeed.target} />}
    </div>
  );
}

/** The ways to reach the team, unfolded under the footer by "Give feedback". */
function FeedbackLinks() {
  const links = [{ label: "Feedback form", url: FEEDBACK_FORM_URL }, ...BOOK_CALL_URLS.map(({ label, url }) => ({ label: `Book a call: ${label}`, url }))];
  return (
    <ul className="space-y-1">
      {links.map(({ label, url }) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "link" }), "text-sm")}>
            {label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PopupApp() {
  const state = usePageState();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const jumped = useJumped(state);
  const access = usePageAccess(state);
  // The display choices are edited on the settings page; the popup only reads
  // them to count the notes a jump can reach.
  const [display] = useNoteDisplay();
  // A fresh site should reach this session now, not on the next scheduled tick.
  useEffect(() => {
    void browser.runtime.sendMessage({ type: "cn-sync-noted-sites" }).catch(() => {});
  }, []);
  // The status counts report what exists and ignore the display choices,
  // while `visible` is what a jump can reach.
  const counts = state.kind === "item" && display ? noteCounts(state.notes, display) : null;

  return (
    <div className="p-4 space-y-4 bg-canvas min-h-[120px]">
      <PrimaryAction state={state} counts={counts} jumped={jumped} access={access} />

      <div className="flex items-center gap-4 border-t border-line pt-4">
        <Button
          variant="quiet"
          className="text-sm"
          onClick={() => {
            void browser.runtime.openOptionsPage();
            window.close();
          }}
        >
          Settings
        </Button>
        <Button variant="quiet" className="text-sm" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((open) => !open)}>
          Give feedback
        </Button>
      </div>
      {feedbackOpen && <FeedbackLinks />}
    </div>
  );
}
