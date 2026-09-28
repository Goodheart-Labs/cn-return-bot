import { useEffect, useState } from "react";
import { YoutubeOverlayApp } from "../../components/YoutubeOverlay";
import type { PageItem } from "@cn/core/items";

/* A mock YouTube watch page with the extension's overlay on it. The page keeps
 * YouTube's own colours and font; only the overlay wears our design. The notes are
 * the fixtures, pinned to 0:10 and 0:40 of a two-minute video. Drag the
 * "seconds" control to move playback: the note card appears while playback is
 * inside a claim's span and fades after it. The pins on the progress bar seek
 * there too. */

export const VIDEO_SECONDS = 120;
/** A playing video reports its position about four times a second. */
const TIME_UPDATE_INTERVAL_MS = 250;

/** A stand-in for YouTube's <video> element. Its playback position is set from
 *  the story's control, and the story fires the `timeupdate` event the overlay
 *  listens to, as a playing video does. */
function createFakeVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  let position = 0;
  Object.defineProperty(video, "duration", { get: () => VIDEO_SECONDS });
  Object.defineProperty(video, "currentTime", {
    get: () => position,
    set: (seconds: number) => {
      position = seconds;
    },
  });
  return video;
}

const THUMBNAIL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><text x="80" y="360" font-family="sans-serif" font-size="52" font-weight="700" fill="#f9fafb">The housing numbers nobody reads</text><text x="80" y="430" font-family="sans-serif" font-size="32" fill="#d1d5db">A placeholder for the video</text></svg>',
  );

/** YouTube's own font, so the page stays the same whichever design our notes wear. */
const HOST_FONT = "Roboto, Arial, sans-serif";

/** One fake video serves every story. */
const video = createFakeVideo();

/** The watch page. `item` is the video's item, whose notes the query cache
 *  must hold. */
export function YoutubeWatch({ seconds, item }: { seconds: number; item: PageItem }) {
  const [player, setPlayer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    player?.appendChild(video);
  }, [player]);
  useEffect(() => {
    video.currentTime = seconds;
  }, [seconds]);
  useEffect(() => {
    const ticks = setInterval(() => video.dispatchEvent(new Event("timeupdate")), TIME_UPDATE_INTERVAL_MS);
    return () => clearInterval(ticks);
  }, []);

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: HOST_FONT }}>
      <header className="flex h-14 items-center gap-6 px-6" style={{ borderBottom: "1px solid #e5e5e5" }}>
        <span className="text-lg font-bold">VideoSite</span>
        <span className="h-9 flex-1 max-w-xl rounded-full" style={{ border: "1px solid #ccc" }} />
      </header>
      <div className="px-6 pt-16 pb-6">
      {/* In the extension the overlay sits in a shadow root, which resets the
          host page's font. The font-sans class on the player stands in for that. */}
      <div ref={setPlayer} id="movie_player" className="relative w-full max-w-[860px] overflow-hidden bg-black font-sans" style={{ aspectRatio: "16 / 9", borderRadius: 12 }}>
        <img src={THUMBNAIL} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-x-3 bottom-3">
          <div className="ytp-progress-bar relative h-1 rounded-full bg-white/30">
            <div className="h-1 rounded-full" style={{ background: "#f00", width: `${(seconds / VIDEO_SECONDS) * 100}%` }} />
          </div>
        </div>
      </div>
      <h1 className="mt-4 max-w-[860px] text-xl font-bold">The housing numbers nobody reads</h1>
      <p className="text-sm" style={{ color: "#606060" }}>The Weekly Ledger · 12,400 views</p>
      </div>
      {player && <YoutubeOverlayApp itemId={item.id} projectSlug={item.projectSlug} video={video} player={player} />}
    </div>
  );
}

