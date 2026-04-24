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
  const display = coreStatus ?? status ?? "unknown";
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
        <StatusBadge status={note.status} coreStatus={note.coreStatus} />
        {note.helpfulCount != null && (
          <span className="text-xs text-gray-500">
            {note.helpfulCount} helpful / {note.notHelpfulCount ?? 0} not helpful
          </span>
        )}
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

// Extract media info from pipeline logs. Handles three shapes:
//   1. Agentic/multi-agent bot (current): logs.media.gemini.{tweetMedia,quotedTweetMedia}[]
//   2. Older pipeline: logs.media.{images,videos}[] with inline description/textContent
//   3. Flat dot-notation (oldest): logs["tweet.text"]
function extractMedia(logs?: Record<string, unknown>): {
  images: { url: string; description?: string; textContent?: string }[];
  videos: { url: string; transcription?: string; keyFrameDescriptions?: string[] }[];
  summary?: string;
  quotedPostContext?: string;
  tweetText?: string;
} {
  const result = { images: [] as any[], videos: [] as any[], summary: undefined as string | undefined, quotedPostContext: undefined as string | undefined, tweetText: undefined as string | undefined };
  if (!logs) return result;

  const media = logs.media as any;
  const tweet = logs.tweet as any;

  // Shape 1: gemini media analyzer emits { type, url, description: { description, ocrText } }
  const gemini = media?.gemini;
  if (gemini && typeof gemini === "object") {
    const merged = [...(gemini.tweetMedia ?? []), ...(gemini.quotedTweetMedia ?? [])];
    for (const m of merged) {
      const desc = m?.description?.description;
      const ocr = m?.description?.ocrText;
      if (m?.type === "image") {
        result.images.push({ url: m.url, description: desc, textContent: ocr });
      } else if (m?.type === "video") {
        result.videos.push({ url: m.url, transcription: desc });
      }
    }
  }

  // Shape 2: legacy inline lists. Only use as a fallback so we don't double-count shape 1.
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

  // Quoted post: prefer the clean referencedTweetData.text; fall back to the AI-prompt wrapper.
  if (tweet && typeof tweet === "object") {
    if (tweet.referencedTweetData?.text && typeof tweet.referencedTweetData.text === "string") {
      result.quotedPostContext = tweet.referencedTweetData.text;
    } else if (tweet.quotedPostContext) {
      result.quotedPostContext = typeof tweet.quotedPostContext === "string"
        ? tweet.quotedPostContext
        : JSON.stringify(tweet.quotedPostContext);
    }
    if (tweet.text) result.tweetText = tweet.text;
  }
  if (logs["tweet.text"] && typeof logs["tweet.text"] === "string") {
    result.tweetText = logs["tweet.text"] as string;
  }

  return result;
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

      {/* Quoted post */}
      {media.quotedPostContext && (
        <div className="bg-white border border-gray-200 rounded p-2 mb-2 text-sm text-gray-600">
          <div className="text-xs text-gray-400 mb-1">Quoted post</div>
          <p className="whitespace-pre-wrap">{media.quotedPostContext}</p>
        </div>
      )}

      {/* Images */}
      {media.images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {media.images.map((img, i) => (
            <div key={i} className="space-y-1">
              <a href={img.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={img.url}
                  alt={img.description ?? `Image ${i + 1}`}
                  className="max-w-[300px] max-h-[250px] rounded border border-gray-200 object-contain cursor-pointer hover:opacity-90"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </a>
              {img.description && (
                <p className="text-xs text-gray-500 max-w-[300px]">
                  <span className="font-medium">AI description:</span> {img.description}
                </p>
              )}
              {img.textContent && (
                <p className="text-xs text-gray-500 max-w-[300px]">
                  <span className="font-medium">Text in image:</span> {img.textContent}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Videos */}
      {media.videos.length > 0 && (
        <div className="space-y-2 mb-2">
          {media.videos.map((vid, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded p-2">
              <div className="text-xs text-gray-400 mb-1">Video {media.videos.length > 1 ? i + 1 : ""}</div>
              {vid.url && (
                <a href={vid.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline block mb-1">
                  {vid.url}
                </a>
              )}
              {vid.transcription && (
                <div className="text-xs text-gray-600">
                  <span className="font-medium">Transcript:</span>
                  <p className="whitespace-pre-wrap mt-0.5">{vid.transcription}</p>
                </div>
              )}
              {vid.keyFrameDescriptions && vid.keyFrameDescriptions.length > 0 && (
                <details className="text-xs text-gray-500 mt-1">
                  <summary className="cursor-pointer">Key frames ({vid.keyFrameDescriptions.length})</summary>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {vid.keyFrameDescriptions.map((desc: string, j: number) => (
                      <li key={j}>{desc}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Media summary if no individual media shown */}
      {media.images.length === 0 && media.videos.length === 0 && media.summary && (
        <div className="text-xs text-gray-500 mb-2">
          <span className="font-medium">Media:</span> {media.summary}
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
