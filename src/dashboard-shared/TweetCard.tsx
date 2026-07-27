import { useEffect, useRef } from "react";
import type { NotedContent, Tweet } from "./types";
import { extractMedia, type MediaImage, type MediaVideo } from "./media";
import { quoteFragmentUrl } from "./textFragment";

function MediaBlock({ images, videos }: { images: MediaImage[]; videos: MediaVideo[] }) {
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
                className="max-w-[300px] max-h-[250px] rounded border border-gray-200 object-contain cursor-pointer hover:opacity-90"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </a>
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {videos.map((vid, i) => vid.url && (
            <a key={i} href={vid.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
              {vid.url}
            </a>
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

      <MediaBlock images={media.images} videos={media.videos} />

      {(media.quotedPostContext || media.quotedImages.length > 0 || media.quotedVideos.length > 0) && (
        <div className="bg-white border border-gray-200 rounded p-2 mb-2 text-sm text-gray-600">
          <div className="text-xs text-gray-400 mb-1">Quoted post</div>
          {media.quotedPostContext && (
            <p className="whitespace-pre-wrap mb-2">{media.quotedPostContext}</p>
          )}
          <MediaBlock images={media.quotedImages} videos={media.quotedVideos} />
        </div>
      )}
    </div>
  );
}

/** "https://www.youtube.com/watch?v=ID&t=42s" / "youtu.be/ID" → "ID". */
function youtubeVideoId(url: string): string | null {
  return url.match(/(?:[?&]v=|youtu\.be\/)([\w-]{6,})/)?.[1] ?? null;
}

/** Quote citation from an article/post, with the source link pinned to the
 *  upper right — mirroring TweetCard's "View on <host> ↗" header placement.
 *  When `fragmentText` is set, the displayed text is a restatement (a claim),
 *  not verbatim source text — so it renders as regular body text, not as a
 *  quote block; the deep-link still targets the verbatim passage. */
function CitationBlock({ quote, url, linkText, fragmentText, updatedQuote, imageGrounded }: {
  quote: string;
  url: string | null;
  linkText: string;
  /** Verbatim source passage for the #:~:text= deep-link, when the displayed
   *  `quote` isn't itself verbatim in the source. Defaults to `quote`. */
  fragmentText?: string;
  /** Current live wording when the source has changed since capture — the
   *  captured quote stays displayed; this renders as "source now reads" and
   *  becomes the deep-link target (it's what a click-through can find). */
  updatedQuote?: string;
  /** The claim rests on an image, not source text — the restated wording is
   *  expected to be absent from the text, so no "not found" warning; the link
   *  goes to the page without a text fragment (there is nothing to target). */
  imageGrounded?: boolean;
}) {
  const verbatim = !fragmentText;
  return (
    <div>
      {url && (
        <div className="flex justify-end mb-1">
          <a href={imageGrounded ? url : quoteFragmentUrl(url, updatedQuote ?? fragmentText ?? quote)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
            {linkText} ↗
          </a>
        </div>
      )}
      {verbatim ? (
        <blockquote className="border-l-4 border-gray-300 pl-3 text-gray-600 italic text-sm">
          “{quote}”
        </blockquote>
      ) : (
        <div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{quote}</p>
          {imageGrounded ? (
            <p className="text-xs text-gray-500 mt-1">Summarized from the image above — not a text quote</p>
          ) : (
            <p className="text-xs text-amber-600 mt-1">⚠ Not an exact quote — this wording isn’t found in the source</p>
          )}
        </div>
      )}
      {updatedQuote && (
        <p className="mt-1.5 pl-3 text-xs text-emerald-700">
          ✎ The source has since been updated and now reads: <em>“{updatedQuote}”</em>
        </p>
      )}
    </div>
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
function YouTubeClip({ url, quote, fragmentText, updatedQuote, imageGrounded, startSeconds, endSeconds }: {
  url: string;
  quote?: string;
  fragmentText?: string;
  updatedQuote?: string;
  imageGrounded?: boolean;
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
      {quote && <CitationBlock quote={quote} url={url} linkText="watch" fragmentText={fragmentText} updatedQuote={updatedQuote} imageGrounded={imageGrounded} />}
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
      return <YouTubeClip url={content.url} quote={content.quote} fragmentText={content.fragmentText} updatedQuote={content.updatedQuote} imageGrounded={content.imageGrounded} startSeconds={content.startSeconds} endSeconds={content.endSeconds} />;
    case "article":
      return <CitationBlock quote={content.quote} url={content.url} linkText={content.url ? sourceLinkLabel(content.url) : ""} fragmentText={content.fragmentText} updatedQuote={content.updatedQuote} imageGrounded={content.imageGrounded} />;
  }
}
