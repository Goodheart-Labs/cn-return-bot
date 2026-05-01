import { Component, useState, type ReactNode } from "react";
import type { ReviewItem, ComparisonNote } from "../lib/types";
import { FAILURE_TYPE_CONFIG } from "../lib/types";
import { JsonViewer } from "./JsonViewer";
import { FailureModeSelector } from "./FailureModeSelector";

interface NoteCardProps {
  item: ReviewItem;
  failureModeCatalog: string[];
  onSeenToggle: (id: string, seen: boolean) => void;
  onFailureModesChange: (id: string, modes: string[]) => void;
  onCreateFailureMode: (name: string) => void;
  onCommentChange: (id: string, comment: string | null) => void;
}

function StatusBadge({ status, coreStatus }: { status?: string; coreStatus?: string }) {
  // Prefer overall status; fall back to core only when overall is missing.
  // Per CLAUDE.md: currentCoreStatus misses notes rated helpful by the
  // expansion or group submodels.
  const display = status ?? coreStatus ?? "unknown";
  const colorMap: Record<string, string> = {
    CURRENTLY_RATED_HELPFUL: "bg-green-100 text-green-800",
    CURRENTLY_RATED_NOT_HELPFUL: "bg-red-100 text-red-800",
    NEEDS_MORE_RATINGS: "bg-blue-100 text-blue-800",
  };
  const color = colorMap[display] ?? "bg-gray-100 text-gray-600";
  const label = display.replace(/CURRENTLY_RATED_/g, "").replace(/_/g, " ");

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>
      {label}
    </span>
  );
}

function noteUrl(noteId: string) {
  return `https://x.com/i/communitynotes/n/${noteId}`;
}

function ComparisonNoteItem({ note }: { note: ComparisonNote }) {
  return (
    <div className="bg-gray-50 rounded p-3 text-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-1">
        <StatusBadge status={note.status} />
        <a
          href={noteUrl(note.noteId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline ml-auto"
        >
          View note ↗
        </a>
      </div>
      <p className="text-gray-700 whitespace-pre-wrap">{note.noteText ?? "No text"}</p>
    </div>
  );
}

type MediaImage = { url: string; description?: string; textContent?: string };
type MediaVideo = { url: string; transcription?: string; keyFrameDescriptions?: string[] };

// Extract media info from pipeline logs. Handles four shapes:
//   1. Agentic/multi-agent bot (current): logs.media.gemini.{tweetMedia,quotedTweetMedia}[]
//   2. Raw X-API media on the Post object: logs.tweet.post.{media,referenced_tweet_data.media}
//   3. Legacy nested: logs.tweet.{media,referencedTweetData.media}
//   4. Older inline lists: logs.media.{images,videos}[]
//   5. Flat dot-notation (oldest): logs["tweet.text"]
// Main-tweet media and quoted-tweet media are returned separately so the UI
// can render each in its own block.
function extractMedia(logs?: Record<string, unknown>): {
  images: MediaImage[];
  videos: MediaVideo[];
  quotedImages: MediaImage[];
  quotedVideos: MediaVideo[];
  summary?: string;
  quotedPostContext?: string;
  tweetText?: string;
} {
  const result = {
    images: [] as MediaImage[],
    videos: [] as MediaVideo[],
    quotedImages: [] as MediaImage[],
    quotedVideos: [] as MediaVideo[],
    summary: undefined as string | undefined,
    quotedPostContext: undefined as string | undefined,
    tweetText: undefined as string | undefined,
  };
  if (!logs) return result;

  const media = logs.media as any;
  const tweet = logs.tweet as any;
  const post = tweet?.post as any;

  const pushMedia = (m: any, imagesOut: MediaImage[], videosOut: MediaVideo[]) => {
    const desc = m?.description?.description;
    const ocr = m?.description?.ocrText;
    if (m?.type === "image") imagesOut.push({ url: m.url, description: desc, textContent: ocr });
    else if (m?.type === "video") videosOut.push({ url: m.url, transcription: desc });
  };

  // Shape 1: gemini media analyzer emits { type, url, description: { description, ocrText } }
  const gemini = media?.gemini;
  if (gemini && typeof gemini === "object") {
    for (const m of gemini.tweetMedia ?? []) pushMedia(m, result.images, result.videos);
    for (const m of gemini.quotedTweetMedia ?? []) pushMedia(m, result.quotedImages, result.quotedVideos);
  }

  // Shape 2: raw Post object — bots without media analysis still have media lists here.
  const tweetMediaSource = Array.isArray(post?.media) ? post.media : (Array.isArray(tweet?.media) ? tweet.media : null);
  if (result.images.length === 0 && result.videos.length === 0 && tweetMediaSource) {
    for (const m of tweetMediaSource) pushMedia(m, result.images, result.videos);
  }
  const quotedMediaSource =
    Array.isArray(post?.referenced_tweet_data?.media) ? post.referenced_tweet_data.media :
    Array.isArray(tweet?.referencedTweetData?.media) ? tweet.referencedTweetData.media : null;
  if (result.quotedImages.length === 0 && result.quotedVideos.length === 0 && quotedMediaSource) {
    for (const m of quotedMediaSource) pushMedia(m, result.quotedImages, result.quotedVideos);
  }

  // Shape 4: legacy inline lists. Only use as a fallback so we don't double-count shape 1.
  if (result.images.length === 0 && result.videos.length === 0 && media && typeof media === "object") {
    if (Array.isArray(media.images)) {
      result.images = media.images.map((img: any) => ({
        url: img.url,
        description: img.description,
        textContent: img.textContent,
      }));
    }
    if (Array.isArray(media.videos)) {
      result.videos = media.videos.map((vid: any) => ({
        url: vid.url,
        transcription: vid.transcription,
        keyFrameDescriptions: vid.keyFrameDescriptions,
      }));
    }
    if (media.summary) result.summary = media.summary;
  }

  // Tweet text + quoted post text: prefer Post object, fall back to legacy paths.
  if (post?.text && typeof post.text === "string") {
    result.tweetText = post.text;
  } else if (tweet?.text && typeof tweet.text === "string") {
    result.tweetText = tweet.text;
  } else if (typeof logs["tweet.text"] === "string") {
    result.tweetText = logs["tweet.text"] as string;
  }

  const quotedText =
    typeof post?.referenced_tweet_data?.text === "string" ? post.referenced_tweet_data.text :
    typeof tweet?.referencedTweetData?.text === "string" ? tweet.referencedTweetData.text :
    typeof tweet?.quotedPostContext === "string" ? tweet.quotedPostContext :
    undefined;
  if (quotedText) result.quotedPostContext = quotedText;

  return result;
}

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

function TweetInline({ item, tweetUrl }: { item: ReviewItem; tweetUrl: string }) {
  const media = extractMedia(item.logs);
  const tweetText = item.tweetText ?? media.tweetText;

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
      {/* Header: handle + link + media badges */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {item.tweetHandle && (
            <span className="text-sm font-medium text-gray-800">@{item.tweetHandle}</span>
          )}
          {item.hasPhoto && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
              {item.mediaCount && item.mediaCount > 1 ? `${item.mediaCount} images` : "image"}
            </span>
          )}
          {item.hasVideo && (
            <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">video</span>
          )}
        </div>
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline"
        >
          View on X ↗
        </a>
      </div>

      {/* Tweet text */}
      {tweetText && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{tweetText}</p>
      )}

      {/* Main-tweet media */}
      <MediaBlock images={media.images} videos={media.videos} />

      {/* Quoted post (text + its own media) */}
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

// Error boundary so one broken card doesn't blank the whole page
class CardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          Card failed to render: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function buildLogsFallback(item: ReviewItem): Record<string, unknown> | undefined {
  const obj: Record<string, unknown> = {};
  if (item.botId) obj.bot_id = item.botId;
  return Object.keys(obj).length > 0 ? obj : undefined;
}

export function NoteCard({
  item,
  failureModeCatalog,
  onSeenToggle,
  onFailureModesChange,
  onCreateFailureMode,
  onCommentChange,
}: NoteCardProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [commentEditing, setCommentEditing] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");

  const tweetUrl = `https://x.com/i/status/${item.tweetId}`;
  const ftConfig = FAILURE_TYPE_CONFIG[item.failureType];
  const seen = item.annotation?.seen ?? false;
  const failureModes = item.annotation?.failureModes ?? [];
  const comment = item.annotation?.comment ?? null;

  return (
    <CardErrorBoundary>
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${seen ? "opacity-60" : ""}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ftConfig.color}`}>
            {ftConfig.label}
          </span>
          {item.competitorLeadTag && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800">
              {item.competitorLeadTag}
            </span>
          )}
          {item.outcome && (
            <span className="text-xs text-gray-500">
              {item.outcome}{item.outcomeReason ? ` (${item.outcomeReason})` : ""}
            </span>
          )}
          {item.result && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {item.result}
            </span>
          )}
          {item.createdAt && (
            <span className="text-xs text-gray-400">
              {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <FailureModeSelector
            selected={failureModes}
            catalog={failureModeCatalog}
            onChange={(modes) => onFailureModesChange(item.id, modes)}
            onCreateNew={onCreateFailureMode}
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={seen}
              onChange={(e) => onSeenToggle(item.id, e.target.checked)}
              className="rounded"
            />
            Seen
          </label>
        </div>
      </div>

      {/* Tweet content */}
      <div className="mb-3">
        <TweetInline item={item} tweetUrl={tweetUrl} />
      </div>

      {/* Our note */}
      {item.noteText && (
        <div className="mb-3 bg-blue-50 rounded p-3 border border-blue-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-blue-600 font-medium">Our note</span>
            {item.noteId && (
              <a
                href={noteUrl(item.noteId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                View note ↗
              </a>
            )}
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{item.noteText}</p>
          {item.sourceUrl && (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline mt-1 block">
              {item.sourceUrl}
            </a>
          )}
        </div>
      )}

      {/* Stats row */}
      {(item.viewCount != null || item.evaluationScore != null) && (
        <div className="flex gap-4 text-xs text-gray-500 mb-3">
          {item.viewCount != null && <span>Views: {item.viewCount.toLocaleString()}</span>}
          {item.ratingCount != null && <span>Ratings: {item.ratingCount}</span>}
          {item.helpfulCount != null && <span>Helpful: {item.helpfulCount}</span>}
          {item.notHelpfulCount != null && <span>Not helpful: {item.notHelpfulCount}</span>}
          {item.evaluationScore != null && <span>Eval: {item.evaluationScore.toFixed(2)}</span>}
        </div>
      )}

      {/* Failure mode tags */}
      {failureModes.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {failureModes.map((m) => (
            <span key={m} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
              {m}
            </span>
          ))}
        </div>
      )}

      {/* Comparison notes */}
      {item.comparisonNotes && item.comparisonNotes.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setComparisonOpen(!comparisonOpen)}
            className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
          >
            <span className="text-xs">{comparisonOpen ? "▼" : "▶"}</span>
            {item.source === "dataset_run" ? "Ground truth" : "Competing notes"}
            <span className="text-xs text-gray-400">({item.comparisonNotes.length})</span>
          </button>
          {comparisonOpen && (
            <div className="mt-2 space-y-2">
              {item.comparisonNotes.map((cn) => (
                <ComparisonNoteItem key={cn.noteId} note={cn} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Comment / note */}
      <div className="mb-3">
        {comment && !commentEditing ? (
          <div className="bg-amber-50 rounded p-3 border border-amber-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-amber-700 font-medium">Note</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setCommentDraft(comment); setCommentEditing(true); }}
                  className="text-xs text-amber-600 hover:text-amber-800"
                >
                  Edit
                </button>
                <button
                  onClick={() => onCommentChange(item.id, null)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{comment}</p>
          </div>
        ) : commentEditing ? (
          <div className="bg-amber-50 rounded p-3 border border-amber-200">
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              className="w-full text-sm border border-amber-300 rounded p-2 bg-white resize-y"
              rows={2}
              placeholder="Add a note..."
              autoFocus
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => {
                  const trimmed = commentDraft.trim();
                  onCommentChange(item.id, trimmed || null);
                  setCommentEditing(false);
                  setCommentDraft("");
                }}
                className="text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700"
              >
                Save
              </button>
              <button
                onClick={() => { setCommentEditing(false); setCommentDraft(""); }}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setCommentDraft(""); setCommentEditing(true); }}
            className="text-xs text-amber-600 hover:text-amber-800"
          >
            + Add note
          </button>
        )}
      </div>

      {/* Pipeline logs */}
      <div>
        <button
          onClick={() => setLogsOpen(!logsOpen)}
          className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
        >
          <span className="text-xs">{logsOpen ? "▼" : "▶"}</span>
          Pipeline logs
        </button>
        {logsOpen && (
          <div className="mt-2">
            <JsonViewer data={item.logs ?? buildLogsFallback(item)} />
          </div>
        )}
      </div>
    </div>
    </CardErrorBoundary>
  );
}
