import { useId, useState } from "react";
import type { NoteRecord, NoteSort } from "../lib/types";
import { TweetCard } from "../../../dashboard-shared/TweetCard";
import { OurNoteCard } from "../../../dashboard-shared/OurNoteCard";
import { Ratings } from "../../../dashboard-shared/Ratings";
import { cnStatusBadge } from "../lib/aggregations";
import { formatViews } from "../lib/format";

const PAGE_SIZE = 10;

const SORT_OPTIONS: { value: NoteSort; label: string }[] = [
  { value: "most_views_helpful", label: "Most views (helpful)" },
  { value: "latest_helpful", label: "Latest helpful" },
  { value: "latest_unhelpful", label: "Latest unhelpful" },
];

export function NoteList({
  notes,
  sort,
  onSortChange,
  variant = "developer",
}: {
  notes: NoteRecord[];
  sort: NoteSort;
  onSortChange: (s: NoteSort) => void;
  variant?: "public" | "developer";
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sortId = useId();
  const isPublic = variant === "public";
  const visibleNotes = notes.slice(0, visible);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{isPublic ? "Highest-impact notes" : "Notes"}</h2>
          {isPublic && <p className="mt-1 text-sm text-gray-500">Rated Helpful, ordered by note views.</p>}
        </div>
        {!isPublic && <div className="flex items-center gap-2 text-sm">
          <label htmlFor={sortId} className="text-gray-500">Show:</label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => { setVisible(PAGE_SIZE); onSortChange(e.target.value as NoteSort); }}
            className="border border-gray-300 rounded px-2 py-1 bg-white"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>}
      </div>

      {visibleNotes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-sm text-gray-500 text-center">
          {isPublic ? "No Helpful notes to show yet." : "No notes match the current selection."}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleNotes.map((n, index) => <StatsNoteCard key={n.note_id} note={n} variant={variant} rank={index + 1} />)}
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

function StatsNoteCard({ note, variant, rank }: { note: NoteRecord; variant: "public" | "developer"; rank: number }) {
  const isPublic = variant === "public";
  const status = cnStatusBadge(note.cn_status);
  const submitted = new Date(note.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const tweetCard = (note.tweet || isPublic) && (
    <TweetCard
      tweet={{
        tweetId: note.tweet_id,
        text: note.tweet?.text ?? undefined,
        handle: note.tweet?.handle ?? undefined,
        hasPhoto: note.tweet?.has_photo,
        hasVideo: note.tweet?.has_video,
        mediaCount: note.tweet?.media_count,
        media: note.tweet?.media ?? undefined,
        referencedTweetData: note.tweet?.referenced_tweet_data ?? undefined,
      }}
    />
  );

  return (
    <article className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${isPublic ? "sm:p-5 break-words [&_img]:max-w-full" : ""}`}>
      {isPublic ? (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <span aria-label={`Rank ${rank}`} className="flex h-10 min-w-10 items-center justify-center rounded-full bg-gray-100 px-2 text-sm font-semibold text-gray-600 tabular-nums">#{rank}</span>
            <div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.className}`}>{status.label}</span>
              <p className="mt-1 text-xs text-gray-500">{submitted}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div title={note.view_count?.toLocaleString("en-US")} className="text-2xl sm:text-3xl font-semibold text-gray-900 tabular-nums">{note.view_count === null ? "—" : formatViews(note.view_count)}</div>
            <div className="text-xs text-gray-500">{note.view_count === null ? "views not recorded" : "note views"}</div>
          </div>
        </div>
      ) : <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.className}`}>{status.label}</span>
        <span className="text-xs text-gray-400">{submitted}</span>
        {note.view_count !== null && note.view_count > 0 && (
          <span className="text-xs text-gray-500">{formatViews(note.view_count)} views</span>
        )}
        <Ratings
          publicDumpRatings={note.public_dump_ratings}
          fallbackHelpfulCount={note.helpful_count}
          fallbackNotHelpfulCount={note.not_helpful_count}
          allowExpand={!!import.meta.env.DEV}
        />
      </div>}

      {isPublic ? (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-medium text-gray-500">Community Note</h3>
            <OurNoteCard noteId={note.note_id} noteText={note.note_text} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-gray-500">Original post</h3>
            {tweetCard}
          </div>
        </div>
      ) : (
        <>
          {tweetCard && <div className="mb-3">{tweetCard}</div>}
          <OurNoteCard noteId={note.note_id} noteText={note.note_text} />
        </>
      )}
    </article>
  );
}
