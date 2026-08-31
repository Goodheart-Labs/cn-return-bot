import "../assets/tailwind.css";
import { createRoot } from "react-dom/client";
import { defineContentScript, createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { fetchItemForUrl, isWholePageChecked, type PageItem } from "../../everything-shared/notesQuery";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";
import { fetchClaimGroups, type ClaimGroup, type NoteCounts } from "../utils/claimGroups";
import { mountCoverageBadges } from "../utils/coverageBadges";
import { getCoveredPageUrls, pageIsCovered } from "../utils/coveredPages";
import { recordPageVisit } from "../utils/linkVisits";
import { YoutubeOverlayApp, DEFAULT_CLIP_SECONDS, type TimedGroup } from "../components/YoutubeOverlay";
import { jumpToNextNote } from "../utils/jumpBus";
import { mountStatusOverlay } from "../utils/mountStatusOverlay";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { listenForRequestInfo } from "../utils/requestInfo";
import { getSettings } from "../utils/settings";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";
import { track } from "../../everything-shared/analytics";

// YouTube's DOM changes often. Every selector we depend on lives here.
const PLAYER_SELECTOR = "#movie_player";
const VIDEO_SELECTOR = "video.html5-main-video";

const PLAYER_WAIT_MS = 15_000;
const PLAYER_POLL_MS = 500;

let lastShownUrl: string | null = null;
let lastVisitUrl: string | null = null;

function waitFor<T extends Element>(selector: string): Promise<T | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      const el = document.querySelector<T>(selector);
      if (el) return resolve(el);
      if (Date.now() - started > PLAYER_WAIT_MS) return resolve(null);
      setTimeout(poll, PLAYER_POLL_MS);
    };
    poll();
  });
}

/** The claims of an item that carry a timestamp, in timeline order. */
function timedGroups(claimGroups: ClaimGroup[]): TimedGroup[] {
  return claimGroups
    .flatMap(({ claimId, notes, nnn }) => {
      const claim = notes[0]!.claim!;
      if (claim.start_seconds == null) return [];
      return [{
        claimId,
        primary: notes[0]!,
        alternatives: notes.slice(1),
        nnn,
        startSeconds: claim.start_seconds,
        endSeconds: claim.end_seconds ?? claim.start_seconds + DEFAULT_CLIP_SECONDS,
      }];
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

/** The transient note-count card on a checked video, gated by its setting. */
async function mountStatus(ctx: ContentScriptContext, counts: NoteCounts, wholePageChecked: boolean): Promise<() => void> {
  if (!(await getSettings()).showNoteCountOverlay) return () => {};
  return (
    await mountStatusOverlay(ctx, {
      noun: "video",
      counts,
      wholePageChecked,
      onOpenNotes: jumpToNextNote,
    })
  ).teardown;
}

async function mountOverlay(ctx: ContentScriptContext): Promise<(() => void) | null> {
  if (!extractYoutubeVideoId(location.href)) return null;
  // Every watch-page visit counts, checked video or not; the counts tell the
  // team which videos are worth checking. Once per video, because
  // yt-navigate-finish re-fires on the same URL.
  const recordWatchVisit = (item: PageItem | null) => {
    if (lastVisitUrl === location.href) return;
    lastVisitUrl = location.href;
    recordPageVisit(location.href, item);
  };
  // We check coverage locally first. Most videos are not covered, and finding
  // that out must not cost a backend lookup on every watch page.
  const covered = await getCoveredPageUrls();
  if (covered && !pageIsCovered(location.href, covered)) {
    recordWatchVisit(null);
    return null;
  }
  // A failed lookup or notes fetch mounts nothing. An outage must not read as
  // "we haven't checked this video yet" with a request button under it.
  let item;
  try {
    item = await fetchItemForUrl(location.href);
  } catch (err) {
    console.warn("[common-notes] item lookup failed, mounting nothing:", err);
    return null;
  }
  if (!item) {
    recordWatchVisit(null);
    return null;
  }
  recordWatchVisit(item);
  // Null on a failed fetch, so the overlay keeps what is on screen.
  const refetch = async () => {
    const next = await fetchClaimGroups(item.id);
    return next === null ? null : timedGroups(next.groups);
  };
  const first = await fetchClaimGroups(item.id);
  if (first === null) {
    console.warn("[common-notes] notes fetch failed, mounting nothing");
    return null;
  }
  const groups = timedGroups(first.groups);
  console.info(`[common-notes] ${groups.length} timestamped claims on this video`);
  const statusTeardown = await mountStatus(ctx, first.counts, isWholePageChecked(item));
  if (groups.length === 0) return statusTeardown;

  const player = await waitFor<HTMLElement>(PLAYER_SELECTOR);
  const video = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
  if (!player || !video) return statusTeardown;

  let themeRoot: HTMLElement | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-yt",
    position: "inline",
    anchor: player,
    onMount(container, _shadow, _shadowHost) {
      // The host element's geometry is set in assets/tailwind.css under
      // `:host(common-notes-yt)`. Inline styles set here would have no effect,
      // because WXT's shadow reset declares `:host{all:initial !important}`.
      // The theme follows YouTube's own theme, sampled from the body element.
      // We cannot sample the player itself, because the #movie_player backdrop
      // is black in both themes.
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      themeRoot = container;
      const root = createRoot(container);
      root.render(<YoutubeOverlayApp groups={groups} projectSlug={item.projectSlug} video={video} player={player} refetch={refetch} />);
      return root;
    },
    onRemove(root) {
      root?.unmount();
    },
  });
  ui.mount();
  // Counted only after the overlay is really up — waitFor(player) can time
  // out — and once per video (yt-navigate-finish re-fires on the same URL).
  if (lastShownUrl !== location.href) {
    lastShownUrl = location.href;
    track("notes_shown", {
      surface: "youtube",
      item_id: item.id,
      claim_count: groups.length,
      note_count: groups.reduce((n, g) => n + 1 + g.alternatives.length, 0),
    });
  }
  // YouTube's appearance toggle flips html[dark] without a reload.
  const stopTheme = observePageTheme((dark) => themeRoot?.classList.toggle("dark", dark));
  return () => {
    stopTheme();
    statusTeardown();
    ui.remove();
  };
}

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    initUiAnalytics();
    registerDevReloadHook(ctx);
    // The background answers a needless request, for example on an already
    // checked video, with an explanation card through this listener.
    listenForRequestInfo(ctx);
    // Listing badges mark noted videos on channel pages and in other video
    // lists. They live independently of the watch-page overlay below.
    const stopBadges = await mountCoverageBadges(ctx);
    ctx.onInvalidated(() => stopBadges?.());
    let cleanup: (() => void) | null = null;
    const init = async () => {
      cleanup?.();
      cleanup = await mountOverlay(ctx);
    };
    await init();
    // YouTube is a single-page app. We resolve the video again on each of its
    // internal navigations.
    ctx.addEventListener(window, "yt-navigate-finish" as keyof WindowEventMap, () => void init());
    ctx.onInvalidated(() => cleanup?.());
  },
});
