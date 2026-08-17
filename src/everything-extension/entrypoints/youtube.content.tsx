import "../assets/tailwind.css";
import { createRoot } from "react-dom/client";
import { defineContentScript, createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { fetchItemForUrl } from "../../everything-shared/notesQuery";
import { extractYoutubeVideoId, normalizePageUrl } from "../../everything-shared/pageUrls";
import { fetchClaimGroups, type ClaimGroup } from "../utils/claimGroups";
import { mountCoverageBadges } from "../utils/coverageBadges";
import { getCoveredPageUrls, pageIsCovered } from "../utils/coveredPages";
import { recordLinkVisit } from "../utils/linkVisits";
import { YoutubeOverlayApp, DEFAULT_CLIP_SECONDS, type TimedGroup } from "../components/YoutubeOverlay";
import type { FollowTarget } from "../utils/followTarget";
import { mountStatusOverlay } from "../utils/mountStatusOverlay";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";
import { track } from "../../everything-shared/analytics";

// YouTube's DOM changes often. Every selector we depend on lives here.
const PLAYER_SELECTOR = "#movie_player";
const VIDEO_SELECTOR = "video.html5-main-video";
const CHANNEL_LINK_SELECTOR = "ytd-video-owner-renderer ytd-channel-name a";

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

/** The channel behind the current watch page, read from the owner box under
 *  the video. Null when the box has not rendered yet or changed shape. */
function channelFollowTarget(): FollowTarget | null {
  const link = document.querySelector<HTMLAnchorElement>(CHANNEL_LINK_SELECTOR);
  if (!link?.href) return null;
  const path = new URL(link.href, location.origin).pathname.match(/^\/(@[\w.-]+|channel\/[\w-]+)/)?.[1];
  if (!path) return null;
  return {
    feedType: "youtube",
    feedUrl: `https://www.youtube.com/${path}`,
    kind: "channel",
    title: link.textContent?.trim() ?? "",
  };
}

/** The transient "have we checked this video" card. On an unchecked video it
 *  offers the request button and, once the owner box has rendered, the
 *  channel-follow button. Whether we already follow the channel cannot be told
 *  from the covered list, which only holds video URLs, so authorCovered stays
 *  false here; the pipeline resolves a repeat follow as already followed. */
async function mountStatus(ctx: ContentScriptContext, noteCount: number | null): Promise<() => void> {
  let followTarget: FollowTarget | null = null;
  if (noteCount === null) {
    // The owner box renders late, so we wait for it before reading the channel.
    await waitFor<HTMLAnchorElement>(CHANNEL_LINK_SELECTOR);
    followTarget = channelFollowTarget();
  }
  return mountStatusOverlay(ctx, {
    pageUrl: normalizePageUrl(location.href),
    noun: "video",
    checked: noteCount === null ? null : { noteCount },
    authorCovered: false,
    followTarget,
    // The pipeline fetches the transcript itself, and this page's text is
    // player chrome rather than the video's content.
    requestWithPageText: false,
  });
}

async function mountOverlay(ctx: ContentScriptContext): Promise<(() => void) | null> {
  if (!extractYoutubeVideoId(location.href)) return null;
  // We check coverage locally first. Most videos are not covered, and finding
  // that out must not cost a backend request on every watch page.
  const covered = await getCoveredPageUrls();
  if (covered && !pageIsCovered(location.href, covered)) return mountStatus(ctx, null);
  const item = await fetchItemForUrl(location.href);
  if (!item) return mountStatus(ctx, null);
  // Once per video, because yt-navigate-finish re-fires on the same URL.
  if (lastVisitUrl !== location.href) {
    lastVisitUrl = location.href;
    recordLinkVisit(item);
  }
  const refetch = async () => timedGroups(await fetchClaimGroups(item.id));
  const groups = await refetch();
  console.info(`[common-notes] ${groups.length} timestamped claims on this video`);
  const statusTeardown = await mountStatus(ctx, groups.reduce((n, g) => n + 1 + g.alternatives.length, 0));
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
