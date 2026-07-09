import type { ClaimRow, ItemRow, NoteRow } from "../lib/types";
import { VoteButtons } from "./VoteButtons";

function YouTubeEmbed({ claim }: { claim: ClaimRow }) {
  const videoId = claim.context_url?.match(/[?&]v=([\w-]{6,})/)?.[1];
  if (!videoId) return null;
  return (
    <iframe
      className="w-full aspect-video rounded-lg"
      src={`https://www.youtube.com/embed/${videoId}?start=${claim.start_seconds ?? 0}`}
      allowFullScreen
      title="Video context"
    />
  );
}

function SourceLinks({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {sources.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
          {new URL(url).hostname.replace(/^www\./, "")}
        </a>
      ))}
    </div>
  );
}

export function NoteCard({ item, claim, note }: { item: ItemRow; claim: ClaimRow; note: NoteRow }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {item.source === "youtube" && <YouTubeEmbed claim={claim} />}
      <blockquote className="border-l-4 border-gray-300 pl-3 text-gray-600 italic text-sm">
        “{claim.context_quote}”
        {claim.context_url && (
          <>
            {" "}
            <a href={claim.context_url} target="_blank" rel="noreferrer" className="text-blue-600 not-italic hover:underline">
              {item.source === "youtube" ? "watch ↗" : "read ↗"}
            </a>
          </>
        )}
      </blockquote>
      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-700">Claim:</span> {claim.claim}
      </p>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-blue-800 mb-1">Community Note</p>
        <p className="text-gray-900 whitespace-pre-wrap">{note.note}</p>
      </div>
      <SourceLinks sources={note.sources} />
      <VoteButtons note={note} />
    </div>
  );
}
