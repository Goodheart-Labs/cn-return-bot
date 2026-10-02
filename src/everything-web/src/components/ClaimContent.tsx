import { useEffect, useRef } from "react";
import { extractYoutubeVideoId, sourceLinkLabel } from "@cn/core/pageUrls";
import { buttonVariants } from "@cn/ui/Button";
import { Quote } from "@cn/ui/typography";
import { quoteFragmentUrl } from "../../../dashboard-shared/textFragment";

const SOURCE_LINK = buttonVariants({ variant: "link", className: "text-xs" });

/** What a note is about: a clip of a YouTube video or a quote from an article. */
export type NotedContent =
  | { kind: "youtube"; url: string; quote?: string; restated?: boolean; updatedQuote?: string; imageGrounded?: boolean; startSeconds?: number | null; endSeconds?: number | null }
  | { kind: "article"; quote: string; restated?: boolean; updatedQuote?: string; imageGrounded?: boolean; post?: PostRef };

/** The post an article quote comes from. `url` is null for a document we were
 *  given as a file without a link to the original. */
interface PostRef {
  title: string;
  url: string | null;
}

/** Names the post a quote comes from, in the upper right corner of the card.
 *  Only the project's All page shows it. There the notes of many posts are
 *  mixed, and without it a reader cannot tell which post a note is about.
 *  The title opens the original post scrolled to the quoted passage. */
function PostLink({ post, passage, imageGrounded }: {
  post: PostRef;
  /** The wording the link scrolls to. When the source has changed, this is the
   *  new wording, because it is the only one a reader can still find there. */
  passage: string;
  /** A claim that rests on an image has no passage in the text, so its link
   *  opens the plain page. */
  imageGrounded?: boolean;
}) {
  return (
    <div className="mb-1 flex justify-end text-right">
      {post.url ? (
        <a href={imageGrounded ? post.url : quoteFragmentUrl(post.url, passage)} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
          {post.title} ↗
        </a>
      ) : (
        <span className="text-xs text-fg-muted">{post.title}</span>
      )}
    </div>
  );
}

/** Shows a quotation from an article or post. When `restated` is set, the
 *  displayed text is a restatement of the source and not the source's own
 *  words, so it renders as ordinary body text instead of as a quote block. */
function CitationBlock({ quote, restated, updatedQuote, imageGrounded }: {
  quote: string;
  restated?: boolean;
  /** The wording the source carries now. It is set when the source changed after
   *  we captured the quote. The captured quote is still the one displayed, and
   *  this text is shown below it as what the source now reads. */
  updatedQuote?: string;
  /** True when the claim rests on an image rather than on source text. The
   *  restated wording is then expected to be missing from the text, so we show
   *  no warning about it. */
  imageGrounded?: boolean;
}) {
  return (
    <div>
      {!restated ? (
        <Quote>“{quote}”</Quote>
      ) : (
        <div>
          <p className="text-sm text-fg whitespace-pre-wrap">{quote}</p>
          {imageGrounded ? (
            <p className="text-xs text-fg-muted mt-1">Summarized from the image above, not a text quote</p>
          ) : (
            <p className="text-xs text-caution mt-1">⚠ Not an exact quote. This wording isn’t found in the source</p>
          )}
        </div>
      )}
      {updatedQuote && (
        <p className="mt-2 pl-3 text-xs text-positive">
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

// Loads YouTube's IFrame Player API once for the whole app. The promise resolves
// when the API is ready to use.
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

/** Embeds a YouTube clip through the IFrame Player API. When playback reaches
 *  the end of the clip we rewind to its start and pause. Otherwise YouTube's own
 *  end screen takes over, and its replay button restarts the whole video from
 *  0:00. */
function YouTubeClip({ url, quote, restated, updatedQuote, imageGrounded, startSeconds, endSeconds }: {
  url: string;
  quote?: string;
  restated?: boolean;
  updatedQuote?: string;
  imageGrounded?: boolean;
  startSeconds?: number | null;
  endSeconds?: number | null;
}) {
  const videoId = extractYoutubeVideoId(url);
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
        playerVars: { start }, // We stop at the right moment ourselves.
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
      {videoId && <div ref={hostRef} className="w-full aspect-video rounded-control overflow-hidden" />}
      {quote && <CitationBlock quote={quote} restated={restated} updatedQuote={updatedQuote} imageGrounded={imageGrounded} />}
      {!videoId && !quote && (
        <a href={url} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
          View on {sourceLinkLabel(url)} ↗
        </a>
      )}
    </div>
  );
}

/**
 * Renders the piece of content a note is about. A YouTube clip is embedded at its start and end timestamps. An
 * article or post is shown as a verbatim citation, below the post's title when `post` is set.
 */
export function ClaimContent({ content }: { content: NotedContent }) {
  switch (content.kind) {
    case "youtube":
      return <YouTubeClip url={content.url} quote={content.quote} restated={content.restated} updatedQuote={content.updatedQuote} imageGrounded={content.imageGrounded} startSeconds={content.startSeconds} endSeconds={content.endSeconds} />;
    case "article":
      return (
        <div>
          {content.post && <PostLink post={content.post} passage={content.updatedQuote ?? content.quote} imageGrounded={content.imageGrounded} />}
          <CitationBlock quote={content.quote} restated={content.restated} updatedQuote={content.updatedQuote} imageGrounded={content.imageGrounded} />
        </div>
      );
  }
}
