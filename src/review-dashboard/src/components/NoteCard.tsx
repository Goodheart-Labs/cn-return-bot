import { useState } from "react";
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
      </div>
      <p className="text-gray-700 whitespace-pre-wrap">{note.noteText ?? "No text"}</p>
    </div>
  );
}

export function NoteCard({
  item,
  failureModeCatalog,
  onSeenToggle,
  onFailureModesChange,
  onCreateFailureMode,
}: NoteCardProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  const tweetUrl = `https://x.com/i/status/${item.tweetId}`;
  const ftConfig = FAILURE_TYPE_CONFIG[item.failureType];
  const seen = item.annotation?.seen ?? false;
  const failureModes = item.annotation?.failureModes ?? [];

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${seen ? "opacity-60" : ""}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ftConfig.color}`}>
            {ftConfig.label}
          </span>
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

      {/* Tweet text */}
      <div className="mb-3">
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm"
        >
          {tweetUrl}
        </a>
        {item.tweetText && (
          <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap line-clamp-4">
            {item.tweetText}
          </p>
        )}
      </div>

      {/* Our note */}
      {item.noteText && (
        <div className="mb-3 bg-blue-50 rounded p-3 border border-blue-100">
          <div className="text-xs text-blue-600 font-medium mb-1">Our note</div>
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
            <JsonViewer data={item.logs} />
          </div>
        )}
      </div>
    </div>
  );
}
