import { useState } from "react";
import type { NoteRecord, NoteSort } from "../lib/types";
import { TweetCard } from "../../../dashboard-shared/TweetCard";
import { cnStatusBadge } from "../lib/aggregations";
import { formatCount, formatViews } from "../lib/format";

const NOTE_URL_PREFIX = "https://x.com/i/communitynotes/n/";
const PAGE_SIZE = 10;

const SORT_OPTIONS: { value: NoteSort; label: string }[] = [
  { value: "latest_helpful", label: "Latest helpful" },
  { value: "most_views_helpful", label: "Most views (helpful)" },
  { value: "latest_unhelpful", label: "Latest unhelpful" },
];

export function NoteList({
  notes,
  sort,
  onSortChange,
}: {
  notes: NoteRecord[];
  sort: NoteSort;
  onSortChange: (s: NoteSort) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const visibleNotes = notes.slice(0, visible);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">Notes</h2>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-500">Show:</label>
          <select
            value={sort}
            onChange={(e) => { setVisible(PAGE_SIZE); onSortChange(e.target.value as NoteSort); }}
            className="border border-gray-300 rounded px-2 py-1 bg-white"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {visibleNotes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-sm text-gray-500 text-center">
          No notes match the current selection.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleNotes.map((n) => <StatsNoteCard key={n.note_id} note={n} />)}
        </div>
      )}

      {visible < notes.length && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-200"
          >
            Show {Math.min(PAGE_SIZE, notes.length - visible)} more
          </button>
        </div>
      )}
    </section>
  );
}

function StatsNoteCard({ note }: { note: NoteRecord }) {
  const status = cnStatusBadge(note.cn_status);
  const submitted = new Date(note.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <article className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.className}`}>{status.label}</span>
        <span className="text-xs text-gray-400">{submitted}</span>
        {note.view_count > 0 && (
          <span className="text-xs text-gray-500">{formatViews(note.view_count)} views</span>
        )}
        {note.rating_count > 0 && (
          <span className="text-xs text-gray-500">
            {formatCount(note.helpful_count)} helpful · {formatCount(note.not_helpful_count)} not helpful
          </span>
        )}
      </div>

      {note.tweet && (
        <div className="mb-3">
          <TweetCard
            tweet={{
              tweetId: note.tweet_id,
              text: note.tweet.text ?? undefined,
              handle: note.tweet.handle ?? undefined,
              hasPhoto: note.tweet.has_photo,
              hasVideo: note.tweet.has_video,
              mediaCount: note.tweet.media_count,
              media: note.tweet.media ?? undefined,
              referencedTweetData: note.tweet.referenced_tweet_data ?? undefined,
            }}
          />
        </div>
      )}

      {note.note_text && (
        <div className="bg-blue-50 rounded p-3 border border-blue-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-blue-600 font-medium">Our note</span>
            <a
              href={NOTE_URL_PREFIX + note.note_id}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              View note ↗
            </a>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.note_text}</p>
          {note.source_url && (
            <a
              href={note.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline mt-1 block"
            >
              {note.source_url}
            </a>
          )}
        </div>
      )}
    </article>
  );
}
