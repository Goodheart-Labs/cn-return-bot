import type { Session } from "@supabase/supabase-js";
import type { ItemRow, NoteRow, SuggestionRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { VoteButtons } from "./VoteButtons";
import { ImproveNote } from "./ImproveNote";

function YouTubeEmbed({ url, start }: { url: string; start: number | null }) {
  const videoId = url.match(/[?&]v=([\w-]{6,})/)?.[1];
  if (!videoId) return null;
  return (
    <iframe
      className="w-full aspect-video rounded-lg"
      src={`https://www.youtube.com/embed/${videoId}?start=${start ?? 0}`}
      allowFullScreen
      title="Video context"
    />
  );
}

function SourceLinks({ sources }: { sources: string[] }) {
  if (!sources?.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {sources.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
          {hostname(url)}
        </a>
      ))}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function NoteCard({ item, note, suggestions, myVote, onVote, session, onNeedLogin }: {
  item: ItemRow;
  note: NoteRow;
  suggestions: SuggestionRow[];
  myVote: Vote | undefined;
  onVote: (note: NoteRow, vote: Vote) => void;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const claim = note.claim;
  const accepted = suggestions.filter((s) => s.status === "accepted");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {item.source === "youtube" && claim?.context_url && <YouTubeEmbed url={claim.context_url} start={claim.start_seconds} />}
      {claim && (
        <blockquote className="border-l-4 border-gray-300 pl-3 text-gray-600 italic text-sm">
          “{claim.context_quote}”
          {claim.context_url?.startsWith("http") && (
            <>
              {" "}
              <a href={claim.context_url} target="_blank" rel="noreferrer" className="text-blue-600 not-italic hover:underline">
                {item.source === "youtube" ? "watch ↗" : "source ↗"}
              </a>
            </>
          )}
        </blockquote>
      )}
      {claim && (
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-700">Claim:</span> {claim.claim}
        </p>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-blue-800 mb-1">Community Note</p>
        <p className="text-gray-900 whitespace-pre-wrap">{note.note}</p>
      </div>
      <SourceLinks sources={note.sources} />

      {accepted.map((s) => (
        <div key={s.id} className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-green-800 mb-1">Community improvement</p>
          <p className="text-gray-900 whitespace-pre-wrap">{s.suggested_text}</p>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <VoteButtons note={note} myVote={myVote} onVote={onVote} />
        <ImproveNote noteId={note.id} session={session} onNeedLogin={onNeedLogin} />
      </div>
    </div>
  );
}
