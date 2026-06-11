import { Component, useState, type ReactNode } from "react";
import type { ReviewItem, ComparisonNote, FailureModeInfo } from "../lib/types";
import { FAILURE_TYPE_CONFIG } from "../lib/types";
import { JsonViewer } from "./JsonViewer";
import { FailureModeSelector } from "./FailureModeSelector";
import { TweetCard } from "../../../dashboard-shared/TweetCard";
import { LinkifiedText } from "../../../dashboard-shared/LinkifiedText";
import { Ratings } from "../../../dashboard-shared/Ratings";
import type { Tweet } from "../../../dashboard-shared/types";

interface NoteCardProps {
  item: ReviewItem;
  failureModeCatalog: FailureModeInfo[];
  failureModeUsage: Map<string, number>;
  onSeenToggle: (id: string, seen: boolean) => void;
  onFailureModesChange: (id: string, modes: string[]) => void;
  onCreateFailureMode: (name: string) => void;
  onCommentChange: (id: string, comment: string | null) => void;
}

function reviewItemToTweet(item: ReviewItem): Tweet {
  return {
    tweetId: item.tweetId,
    text: item.tweetText,
    handle: item.tweetHandle,
    hasPhoto: item.hasPhoto,
    hasVideo: item.hasVideo,
    mediaCount: item.mediaCount,
    media: item.tweetMedia,
    referencedTweetData: item.referencedTweetData,
  };
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
      <LinkifiedText className="text-gray-700 whitespace-pre-wrap" text={note.noteText ?? "No text"} />
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
  failureModeUsage,
  onSeenToggle,
  onFailureModesChange,
  onCreateFailureMode,
  onCommentChange,
}: NoteCardProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [commentEditing, setCommentEditing] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");

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
            usage={failureModeUsage}
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
        <TweetCard tweet={reviewItemToTweet(item)} />
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
          <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={item.noteText} />
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
        {item.viewCount != null && <span>Views: {item.viewCount.toLocaleString()}</span>}
        <Ratings
          publicDumpRatings={item.publicDumpRatings}
          fallbackHelpfulCount={item.helpfulCount}
          fallbackNotHelpfulCount={item.notHelpfulCount}
        />
        {item.evaluationScore != null && <span>Eval: {item.evaluationScore.toFixed(2)}</span>}
      </div>

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

      {/* Annotation context (big_eval dataset rows) */}
      {(item.judgeGuidance || item.originalNoteText || item.failureReason) && (
        <div className="mb-3 bg-yellow-50 rounded p-3 border border-yellow-200 space-y-2 text-sm">
          {item.judgeGuidance && (
            <div>
              <div className="text-xs font-medium text-yellow-800 mb-0.5">Judge guidance</div>
              <p className="text-gray-800 whitespace-pre-wrap">{item.judgeGuidance}</p>
            </div>
          )}
          {item.originalNoteText && (
            <div>
              <div className="text-xs font-medium text-yellow-800 mb-0.5">Original note text</div>
              <p className="text-gray-800 whitespace-pre-wrap">{item.originalNoteText}</p>
            </div>
          )}
          {item.failureReason && (
            <div>
              <div className="text-xs font-medium text-yellow-800 mb-0.5">Failure reason</div>
              <p className="text-gray-800 whitespace-pre-wrap">{item.failureReason}</p>
            </div>
          )}
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
