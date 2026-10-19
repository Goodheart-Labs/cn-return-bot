import "../assets/tailwind.css";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@cn/features/query/queryClient";
import { defineContentScript } from "#imports";
import type { ContentScriptContext } from "#imports";
import { fetchItemForUrl, type PageItem } from "@cn/core/items";
import { extractYoutubeVideoId } from "@cn/core/pageUrls";
import { claimGroups, itemNoteSetQuery } from "../utils/claimGroups";
import { mountCoverageBadges } from "../utils/coverageBadges";
import { getCoveredPageUrls, pageIsCovered } from "../utils/coveredPages";
import { recordPageVisit } from "../utils/linkVisits";
import { PillPaletteFromSettings } from "../components/PillPaletteFromSettings";
import { timedGroups, YoutubeOverlayApp } from "../components/YoutubeOverlay";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { listenForRequestInfo } from "../utils/requestInfo";
import { listenForLiveRequests } from "../utils/requestLive";
import { getNoteDisplay } from "../utils/settings";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";
import { track } from "@cn/core/analytics";
import { createOverlayUi } from "../utils/overlayUi";

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
  let noteSet;
  try {
    noteSet = await queryClient.fetchQuery(itemNoteSetQuery(item.id));
  } catch (err) {
    console.warn("[common-notes] notes fetch failed, mounting nothing:", err);
    return null;
  }
  const groups = timedGroups(claimGroups(noteSet, await getNoteDisplay()));
  console.info(`[common-notes] ${groups.length} timestamped claims on this video`);
  if (groups.length === 0) return null;

  const player = await waitFor<HTMLElement>(PLAYER_SELECTOR);
  const video = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
  if (!player || !video) return null;

  let themeRoot: HTMLElement | null = null;
  // The host lives on the page body, not inside the player, so the card can
  // be dragged over the whole page. Its geometry is set in assets/tailwind.css
  // under `:host(common-notes-yt)`. The scrub-bar pins reach the player on
  // their own.
  const ui = await createOverlayUi(ctx, {
    name: "common-notes-yt",
    position: "inline",
    anchor: "body",
    onMount(container, _shadow, _shadowHost) {
      // The theme follows YouTube's own theme, sampled from the body element.
      // We cannot sample the player itself, because the #movie_player backdrop
      // is black in both themes.
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      themeRoot = container;
      const root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <PillPaletteFromSettings>
            <YoutubeOverlayApp itemId={item.id} projectSlug={item.projectSlug} video={video} player={player} />
          </PillPaletteFromSettings>
        </QueryClientProvider>,
      );
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
      note_count: groups.reduce((n, g) => n + g.notes.length, 0),
    });
  }
  // YouTube's appearance toggle flips html[dark] without a reload.
  const stopTheme = observePageTheme((dark) => themeRoot?.classList.toggle("dark", dark));
  return () => {
    stopTheme();
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
    listenForLiveRequests(ctx);
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
