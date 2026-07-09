import type { Session } from "@supabase/supabase-js";
import { ContentCard } from "../../../dashboard-shared/TweetCard";
import type { NotedContent } from "../../../dashboard-shared/types";
import type { ClaimRef, NoteRow, SuggestionRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { VoteButtons } from "./VoteButtons";
import { ImproveNote } from "./ImproveNote";

/** Map a claim's context to the shared ContentCard shape: a YouTube clip when
 *  the context URL is a video (embedded at its timestamp span), else an
 *  article citation. Decided by URL, not item.source — a podcast item with a
 *  YouTube deep-link renders as a clip. */
function claimContent(claim: ClaimRef): NotedContent {
  const url = claim.context_url;
  if (url && /youtube\.com|youtu\.be/.test(url)) {
    return {
      kind: "youtube",
      url,
      quote: claim.context_quote,
      startSeconds: claim.start_seconds,
      endSeconds: claim.end_seconds,
    };
  }
  return { kind: "article", url, quote: claim.context_quote };
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

export function NoteCard({ note, suggestions, myVote, onVote, session, onNeedLogin }: {
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
      {claim && <ContentCard content={claimContent(claim)} />}
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
