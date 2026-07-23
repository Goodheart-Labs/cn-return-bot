import "../assets/tailwind.css";
import { createRoot } from "react-dom/client";
import { defineContentScript, createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { originalsFirst } from "../../everything-shared/noteScore";
import { fetchItemForUrl, fetchNotesForItem, extractYoutubeVideoId } from "../../everything-shared/notesQuery";
import type { NoteRow } from "../../everything-shared/types";
import { YoutubeOverlayApp, DEFAULT_CLIP_SECONDS, type TimedGroup } from "../components/YoutubeOverlay";
import { isPageDark, observePageTheme } from "../utils/pageTheme";
import { registerDevReloadHook } from "../utils/devReload";

// YouTube's DOM churns; every selector we depend on lives here.
const PLAYER_SELECTOR = "#movie_player";
const VIDEO_SELECTOR = "video.html5-main-video";

const PLAYER_WAIT_MS = 15_000;
const PLAYER_POLL_MS = 500;

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

/** Group notes per timestamped claim, promoted order. */
function timedGroups(notes: NoteRow[]): TimedGroup[] {
  const byClaim = new Map<string, NoteRow[]>();
  for (const note of notes) {
    if (note.claim?.start_seconds == null) continue;
    const list = byClaim.get(note.claim_id);
    if (list) list.push(note);
    else byClaim.set(note.claim_id, [note]);
  }
  return [...byClaim.entries()]
    .map(([claimId, group]) => {
      const sorted = [...group].sort(originalsFirst);
      const claim = sorted[0]!.claim!;
      return {
        claimId,
        primary: sorted[0]!,
        alternatives: sorted.slice(1),
        startSeconds: claim.start_seconds!,
        endSeconds: claim.end_seconds ?? claim.start_seconds! + DEFAULT_CLIP_SECONDS,
      };
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

async function mountOverlay(ctx: ContentScriptContext): Promise<(() => void) | null> {
  if (!extractYoutubeVideoId(location.href)) return null;
  const item = await fetchItemForUrl(location.href);
  if (!item) return null;
  const groups = timedGroups(await fetchNotesForItem(item.id));
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
      // Host geometry lives in assets/tailwind.css (`:host(common-notes-yt)`)
      // — inline styles set here are dead on arrival, WXT's shadow reset
      // (`:host{all:initial !important}`) overrides them.
      // Theme follows the PAGE (YouTube's own theme), sampled from body — the
      // #movie_player backdrop is black in both themes.
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      themeRoot = container;
      const root = createRoot(container);
      root.render(<YoutubeOverlayApp groups={groups} projectSlug={item.projectSlug} video={video} />);
      return root;
    },
    onRemove(root) {
      root?.unmount();
    },
  });
  ui.mount();
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
    registerDevReloadHook(ctx);
    let cleanup: (() => void) | null = null;
    const init = async () => {
      cleanup?.();
      cleanup = await mountOverlay(ctx);
    };
    await init();
    // YouTube is a SPA; re-resolve the video on its internal navigations.
    ctx.addEventListener(window, "yt-navigate-finish" as keyof WindowEventMap, () => void init());
    ctx.onInvalidated(() => cleanup?.());
  },
});
