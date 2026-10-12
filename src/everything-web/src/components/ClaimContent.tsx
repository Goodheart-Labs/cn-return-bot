import { useEffect, useRef } from "react";
import type { ClaimRef, FeedItemRow } from "@cn/core/types";
import { extractYoutubeVideoId, sourceLinkLabel } from "@cn/core/pageUrls";
import { buttonVariants } from "@cn/ui/Button";
import { Quote } from "@cn/ui/typography";
import { quoteFragmentUrl } from "../../../dashboard-shared/textFragment";

const SOURCE_LINK = buttonVariants({ variant: "link", className: "text-xs" });

/** What a note is about: a clip of a YouTube video or a quote from an article. */
export type NotedContent =
  | { kind: "youtube"; url: string; quote?: string; restated?: boolean; updatedQuote?: string; startSeconds?: number | null; endSeconds?: number | null }
  | { kind: "article"; quote?: string; restated?: boolean; updatedQuote?: string; post?: PostRef };

/** The post an article quote comes from. `url` is null for a document we were
 *  given as a file without a link to the original. */
interface PostRef {
  title: string;
  url: string | null;
}

/** Maps a claim's context onto the NotedContent shape. A context URL that
 *  points at a video becomes a YouTube clip, embedded at the claim's timestamp
 *  span. Anything else becomes an article citation. The URL decides this, not
 *  item.source, so a podcast item whose context is a YouTube deep-link still
 *  renders as a clip.
 *
 *  The citation line is the verbatim `context_quote` excerpt. The `claim` column
 *  is not source text. It is a self-contained restatement, written so the claim
 *  can be fact-checked on its own. A claim without an excerpt falls back to that
 *  restatement, which is rendered without quote marks and with a warning.
 *  A claim grounded in an image gets no citation at all. The card already
 *  shows the image, and the note says what it disputes in it.
 *
 *  An article citation names `post` when it is given. A clip does not need it,
 *  because the embedded player already shows the video and links to it. */
export function claimContent(claim: ClaimRef, post: FeedItemRow | undefined): NotedContent {
  const url = claim.context_url;
  const imageGrounded = !claim.context_quote && claim.image_urls.length > 0;
  const quote = claim.context_quote || (imageGrounded ? undefined : claim.claim);
  const restated = !claim.context_quote;
  const updatedQuote = claim.updated_quote ?? undefined;
  if (url && /youtube\.com|youtu\.be/.test(url)) {
    return { kind: "youtube", url, quote, restated, updatedQuote, startSeconds: claim.start_seconds, endSeconds: claim.end_seconds };
  }
  return { kind: "article", quote, restated, updatedQuote, post: post && { title: post.title ?? "Untitled", url } };
}

/** Names the post a quote comes from, in the upper right corner of the card.
 *  Only the project's All page shows it. There the notes of many posts are
 *  mixed, and without it a reader cannot tell which post a note is about.
 *  The title opens the original post scrolled to the quoted passage. */
function PostLink({ post, passage }: {
  post: PostRef;
  /** The wording the link scrolls to. When the source has changed, this is the
   *  new wording, because it is the only one a reader can still find there.
   *  A claim that rests on an image has no passage, so its link opens the
   *  plain page. */
  passage?: string;
}) {
  return (
    <div className="mb-1 flex justify-end text-right">
      {post.url ? (
        <a href={passage ? quoteFragmentUrl(post.url, passage) : post.url} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
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
function CitationBlock({ quote, restated, updatedQuote }: {
  quote: string;
  restated?: boolean;
  /** The wording the source carries now. It is set when the source changed after
   *  we captured the quote. The captured quote is still the one displayed, and
   *  this text is shown below it as what the source now reads. */
  updatedQuote?: string;
}) {
  return (
    <div>
      {!restated ? (
        <Quote>“{quote}”</Quote>
      ) : (
        <div>
          <p className="text-sm text-fg whitespace-pre-wrap">{quote}</p>
          <p className="text-xs text-caution mt-1">⚠ Not an exact quote. This wording isn’t found in the source</p>
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
function YouTubeClip({ url, quote, restated, updatedQuote, startSeconds, endSeconds }: {
  url: string;
  quote?: string;
  restated?: boolean;
  updatedQuote?: string;
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
      {quote && <CitationBlock quote={quote} restated={restated} updatedQuote={updatedQuote} />}
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
      return <YouTubeClip url={content.url} quote={content.quote} restated={content.restated} updatedQuote={content.updatedQuote} startSeconds={content.startSeconds} endSeconds={content.endSeconds} />;
    case "article":
      return (
        <div>
          {content.post && <PostLink post={content.post} passage={content.updatedQuote ?? content.quote} />}
          {content.quote && <CitationBlock quote={content.quote} restated={content.restated} updatedQuote={content.updatedQuote} />}
        </div>
      );
  }
}
