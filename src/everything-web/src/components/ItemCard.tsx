import type { Session } from "@supabase/supabase-js";
import type { ItemRow, NoteRow, SuggestionRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { NoteCard } from "./NoteCard";

const SOURCE_BADGES: Record<ItemRow["source"], { label: string; className: string }> = {
  youtube: { label: "YouTube", className: "bg-red-100 text-red-700" },
  substack: { label: "Substack", className: "bg-orange-100 text-orange-700" },
  podcast: { label: "Podcast", className: "bg-purple-100 text-purple-700" },
};

export function ItemCard({ item, notes, suggestionsByNote, myVotes, onVote, session, onNeedLogin }: {
  item: ItemRow;
  notes: NoteRow[];
  suggestionsByNote: Map<string, SuggestionRow[]>;
  myVotes: Map<string, Vote>;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const badge = SOURCE_BADGES[item.source];
  const processing = item.status === "queued" || item.status === "processing";
  const isLink = item.url.startsWith("http");

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>{badge.label}</span>
        {isLink ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="text-lg font-semibold hover:underline">
            {item.title ?? item.url}
          </a>
        ) : (
          <span className="text-lg font-semibold">{item.title ?? item.url}</span>
        )}
        {item.published_at && <span className="text-sm text-gray-500">{item.published_at}</span>}
        {processing && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 animate-pulse">
            {item.status === "queued" ? "queued" : "checking…"}
          </span>
        )}
        {item.status === "error" && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700" title={item.error ?? ""}>error</span>
        )}
      </div>

      {notes.length > 0 ? (
        <>
          <p className="text-sm text-gray-500">{notes.length} {notes.length === 1 ? "note" : "notes"}</p>
          <div className="space-y-3">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                suggestions={suggestionsByNote.get(note.id) ?? []}
                myVote={myVotes.get(note.id)}
                onVote={onVote}
                session={session}
                onNeedLogin={onNeedLogin}
              />
            ))}
          </div>
        </>
      ) : (
        item.status === "done" && <p className="text-sm text-gray-400">No notes on this one.</p>
      )}
    </div>
  );
}
