import "../assets/tailwind.css";
import { createRoot } from "react-dom/client";
import { defineContentScript, createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { fetchItemForUrl, extractYoutubeVideoId } from "../../everything-shared/notesQuery";
import { fetchClaimGroups, type ClaimGroup } from "../utils/claimGroups";
import { getCoveredPageUrls, pageIsCovered } from "../utils/coveredPages";
import { YoutubeOverlayApp, DEFAULT_CLIP_SECONDS, type TimedGroup } from "../components/YoutubeOverlay";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { getDisabledSites } from "../utils/settings";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";
import { track } from "../../everything-shared/analytics";

// YouTube's DOM changes often. Every selector we depend on lives here.
const PLAYER_SELECTOR = "#movie_player";
const VIDEO_SELECTOR = "video.html5-main-video";

const PLAYER_WAIT_MS = 15_000;
const PLAYER_POLL_MS = 500;

let lastShownUrl: string | null = null;

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

async function mountOverlay(ctx: ContentScriptContext): Promise<(() => void) | null> {
  if (!extractYoutubeVideoId(location.href)) return null;
  // We check coverage locally first. Most videos are not covered, and finding
  // that out must not cost a backend request on every watch page.
  const covered = await getCoveredPageUrls();
  if (covered && !pageIsCovered(location.href, covered)) return null;
  const item = await fetchItemForUrl(location.href);
  if (!item) return null;
  const refetch = async () => timedGroups(await fetchClaimGroups(item.id));
  const groups = await refetch();
  console.info(`[common-notes] ${groups.length} timestamped claims on this video`);
  if (groups.length === 0) return null;

  const player = await waitFor<HTMLElement>(PLAYER_SELECTOR);
  const video = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
  if (!player || !video) return null;

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
    ui.remove();
  };
}

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    // The user switched notes off for this site in the popup.
    if ((await getDisabledSites()).includes(location.hostname)) return;
    initUiAnalytics();
    registerDevReloadHook(ctx);
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
