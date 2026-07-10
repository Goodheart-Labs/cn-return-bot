import { useEffect, useRef, useState } from "react";
import type { NotedContent, Tweet } from "./types";
import { extractMedia, type MediaImage, type MediaVideo } from "./media";
import { proxiedVideoUrl } from "./videoProxy";

const MEDIA_SIZE_CLASSES = "max-w-[300px] max-h-[250px] rounded border border-gray-200 object-contain";

/** Tweet video, played through the dashboard server's same-origin /video-proxy
 *  (video.twimg.com never delivers bytes to cross-origin <video> requests).
 *  Where no proxy is running — e.g. the deployed GitHub Pages stats site — the
 *  load errors immediately and we fall back to the poster thumbnail linking
 *  out to the post. */
function TweetVideo({ video, linkUrl }: { video: MediaVideo; linkUrl: string | null }) {
  const [proxyUnavailable, setProxyUnavailable] = useState(false);

  if (!proxyUnavailable) {
    return (
      <video
        src={proxiedVideoUrl(video.url)}
        poster={video.posterUrl}
        controls
        preload="metadata"
        className={`${MEDIA_SIZE_CLASSES} bg-black`}
        onError={() => setProxyUnavailable(true)}
      />
    );
  }

  if (!video.posterUrl) {
    return linkUrl ? (
      <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
        Watch video ↗
      </a>
    ) : null;
  }

  const poster = (
    <span className="relative inline-block">
      <img src={video.posterUrl} alt="Video preview" className={MEDIA_SIZE_CLASSES} loading="lazy" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center text-lg">▶</span>
      </span>
    </span>
  );
  return linkUrl ? (
    <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-90">{poster}</a>
  ) : poster;
}

function MediaBlock({ images, videos, videoLinkUrl }: {
  images: MediaImage[];
  videos: MediaVideo[];
  videoLinkUrl: string | null;
}) {
  if (images.length === 0 && videos.length === 0) return null;
  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((img, i) => (
            <a key={i} href={img.url} target="_blank" rel="noopener noreferrer">
              <img
                src={img.url}
                alt={`Image ${i + 1}`}
                className={`${MEDIA_SIZE_CLASSES} cursor-pointer hover:opacity-90`}
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </a>
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {videos.map((vid, i) => (
            <TweetVideo key={i} video={vid} linkUrl={videoLinkUrl} />
          ))}
        </div>
      )}
    </>
  );
}

// "View on <domain>" label: nicer names for the common hosts, bare hostname
// otherwise.
function sourceLinkLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
  if (host === "x.com" || host === "twitter.com") return "X";
  if (host === "youtube.com" || host === "youtu.be") return "YouTube";
  return host;
}

export function TweetCard({ tweet }: { tweet: Tweet }) {
  const media = extractMedia(tweet.media, tweet.referencedTweetData);
  // Prefer an explicit source link (e.g. timestamped YouTube for podcast items);
  // otherwise fall back to the X status URL. Hide the link entirely when neither
  // is available (e.g. a podcast item whose link hasn't been backfilled yet).
  const sourceUrl = tweet.sourceUrl?.trim()
    ? tweet.sourceUrl
    : tweet.tweetId
      ? `https://x.com/i/status/${tweet.tweetId}`
      : null;

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {tweet.handle && (
            <span className="text-sm font-medium text-gray-800">@{tweet.handle}</span>
          )}
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            View on {sourceLinkLabel(sourceUrl)} ↗
          </a>
        )}
      </div>

      {tweet.text && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{tweet.text}</p>
      )}

      <MediaBlock images={media.images} videos={media.videos} videoLinkUrl={sourceUrl} />

      {(media.quotedPostContext || media.quotedImages.length > 0 || media.quotedVideos.length > 0) && (
        <div className="bg-white border border-gray-200 rounded p-2 mb-2 text-sm text-gray-600">
          <div className="text-xs text-gray-400 mb-1">Quoted post</div>
          {media.quotedPostContext && (
            <p className="whitespace-pre-wrap mb-2">{media.quotedPostContext}</p>
          )}
          <MediaBlock images={media.quotedImages} videos={media.quotedVideos} videoLinkUrl={sourceUrl} />
        </div>
      )}
    </div>
  );
}

/** "https://www.youtube.com/watch?v=ID&t=42s" / "youtu.be/ID" → "ID". */
function youtubeVideoId(url: string): string | null {
  return url.match(/(?:[?&]v=|youtu\.be\/)([\w-]{6,})/)?.[1] ?? null;
}

/** Quote citation from an article/post, with a link to the source. */
function CitationBlock({ quote, url, linkText }: { quote: string; url: string | null; linkText: string }) {
  return (
    <blockquote className="border-l-4 border-gray-300 pl-3 text-gray-600 italic text-sm">
      “{quote}”
      {url && (
        <>
          {" "}
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 not-italic hover:underline">
            {linkText} ↗
          </a>
        </>
      )}
    </blockquote>
  );
}

interface YouTubePlayer {
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  pauseVideo(): void;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: { onStateChange?: (e: { data: number }) => void };
    },
  ) => YouTubePlayer;
  PlayerState: { PLAYING: number };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Load the IFrame Player API once for the whole app; resolves when YT is ready.
let youtubeApiReady: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (youtubeApiReady) return youtubeApiReady;
  youtubeApiReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return youtubeApiReady;
}

const CLIP_END_POLL_MS = 200;

/** Embed a YouTube clip via the IFrame Player API so that reaching the clip's
 *  end rewinds to its start and pauses — instead of YouTube's native end screen,
 *  whose replay button restarts the whole video from 0:00. */
function YouTubeClip({ url, quote, startSeconds, endSeconds }: {
  url: string;
  quote?: string;
  startSeconds?: number | null;
  endSeconds?: number | null;
}) {
  const videoId = youtubeVideoId(url);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!videoId) return;
    const start = startSeconds != null ? Math.max(0, Math.floor(startSeconds)) : 0;
    const end = endSeconds != null ? Math.ceil(endSeconds) : null;
    let player: YouTubePlayer | undefined;
    let endPoll: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current) return;
      player = new window.YT!.Player(hostRef.current, {
        videoId,
        playerVars: { start }, // no `end` param — we stop precisely, ourselves
        events: {
          onStateChange: (e) => {
            clearInterval(endPoll);
            if (e.data === window.YT!.PlayerState.PLAYING && end != null) {
              endPoll = setInterval(() => {
                if (player!.getCurrentTime() >= end) {
                  player!.seekTo(start, true);
                  player!.pauseVideo();
                }
              }, CLIP_END_POLL_MS);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearInterval(endPoll);
      player?.destroy();
    };
  }, [videoId, startSeconds, endSeconds]);

  return (
    <div className="space-y-2">
      {videoId && <div ref={hostRef} className="w-full aspect-video rounded-lg overflow-hidden" />}
      {quote && <CitationBlock quote={quote} url={url} linkText="watch" />}
      {!videoId && !quote && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
          View on {sourceLinkLabel(url)} ↗
        </a>
      )}
    </div>
  );
}

/**
 * Renders whatever piece of content a note is about: an X post (the classic
 * TweetCard), a YouTube clip embedded at its [start, end] timestamp span, or a
 * verbatim citation from an article/post linking back to the source.
 */
export function ContentCard({ content }: { content: NotedContent }) {
  switch (content.kind) {
    case "tweet":
      return <TweetCard tweet={content.tweet} />;
    case "youtube":
      return <YouTubeClip url={content.url} quote={content.quote} startSeconds={content.startSeconds} endSeconds={content.endSeconds} />;
    case "article":
      return <CitationBlock quote={content.quote} url={content.url} linkText={content.url ? sourceLinkLabel(content.url) : ""} />;
  }
}
