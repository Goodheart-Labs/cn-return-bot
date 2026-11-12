// YouTube's watch page and its player. YouTube's DOM changes often, so every
// selector of the player that we depend on lives here.

export const PLAYER_SELECTOR = "#movie_player";
const VIDEO_SELECTOR = "video.html5-main-video";
const WATCH_TITLE_SELECTOR = "ytd-watch-metadata h1";
const WATCH_PATH = "/watch";

/** The video element of the watch page's player, or null while there is none. */
export function mainVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
}

/** The title of the video a watch page plays, without the " - YouTube" that
 *  the tab's title adds. */
export function watchPageTitle(): string {
  return document.querySelector(WATCH_TITLE_SELECTOR)?.textContent?.trim() || document.title;
}

/** The id of the video a watch page plays. Null on every other page, Shorts
 *  included, because a Short plays at an address of its own. */
export function watchPageVideoId(href: string): string | null {
  const url = new URL(href);
  return url.pathname === WATCH_PATH ? url.searchParams.get("v") : null;
}

/** The watch page's video when a reader can write a note on a stretch of it.
 *  A live stream has no fixed length, which the browser reports as an
 *  infinite duration, and gets no notes. */
export function writableVideo(): { videoId: string; video: HTMLVideoElement } | null {
  const videoId = watchPageVideoId(location.href);
  const video = mainVideo();
  if (!videoId || !video || !Number.isFinite(video.duration)) return null;
  return { videoId, video };
}
