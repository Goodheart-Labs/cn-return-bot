import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "../../everything-web/src/components/NoteCard";
import { noteStatus } from "../../everything-shared/noteScore";
import type { NoteRow } from "../../everything-shared/types";
import { noteShareUrl } from "../utils/share";
import { NoteWithActions } from "./NoteWithActions";
import { useNoteVoting, replaceNoteInGroup } from "./useNoteVoting";

/** A claim pinned to a span of the video timeline. */
export interface TimedGroup {
  claimId: string;
  primary: NoteRow;
  alternatives: NoteRow[];
  startSeconds: number;
  endSeconds: number;
}

// A claim without end_seconds stays up this long past its start.
export const DEFAULT_CLIP_SECONDS = 30;
// Keep the pill up briefly after the video leaves the claim's window so a
// viewer can still reach it.
const LINGER_MS = 5_000;

const QUOTE_PREVIEW_CHARS = 160;

function quotePreview(group: TimedGroup): string | null {
  const quote = group.primary.claim?.context_quote;
  if (!quote) return null;
  return quote.length > QUOTE_PREVIEW_CHARS ? `${quote.slice(0, QUOTE_PREVIEW_CHARS)}…` : quote;
}

/** Timestamp-triggered community note over the YouTube player: a minimized
 *  pill while the claim's span plays, expandable to the full votable card. */
export function YoutubeOverlayApp({ groups: initialGroups, projectSlug, video }: {
  groups: TimedGroup[];
  projectSlug: string | null;
  video: HTMLVideoElement;
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [activeClaim, setActiveClaim] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dismissed = useRef(new Set<string>()); // per-video-session
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { session, myVotes, handleVote, recordAuthored, onNeedLogin, signInHint, dismissSignInHint } = useNoteVoting(
    (updated) => setGroups((prev) => prev.map((g) => replaceNoteInGroup(g, updated))),
  );
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const onTime = () => {
      const t = video.currentTime;
      const hit = groups.find((g) => !dismissed.current.has(g.claimId) && t >= g.startSeconds && t <= g.endSeconds);
      if (hit) {
        clearTimeout(lingerTimer.current);
        setActiveClaim((cur) => (cur === hit.claimId ? cur : hit.claimId));
      } else if (!expandedRef.current) {
        // Leave the pill up briefly, then drop it; an expanded card stays.
        clearTimeout(lingerTimer.current);
        lingerTimer.current = setTimeout(() => {
          if (!expandedRef.current) setActiveClaim(null);
        }, LINGER_MS);
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      clearTimeout(lingerTimer.current);
    };
  }, [groups, video]);

  const group = groups.find((g) => g.claimId === activeClaim);
  if (!group) return null;
  const note = group.primary;
  const quote = quotePreview(group);

  const dismiss = () => {
    dismissed.current.add(group.claimId);
    setActiveClaim(null);
    setExpanded(false);
  };

  return (
    <div className="pointer-events-auto text-left">
      {signInHint && (
        <div className="mb-2 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-sm text-gray-700 flex items-center gap-3">
          Sign in from the Common Notes toolbar icon to vote or write notes.
          <button onClick={dismissSignInHint} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 bg-white/95 border border-gray-200 rounded-full shadow-xl px-3 py-1.5 hover:bg-white"
        >
          <StatusBadge status={noteStatus(note)} />
        </button>
      ) : (
        <div className="w-[26rem] max-w-[80vw] max-h-[70vh] overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-2xl p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-500">Community note on this part of the video</span>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setExpanded(false)} title="Minimize" className="px-1.5 text-gray-400 hover:text-gray-700">–</button>
              <button onClick={dismiss} title="Dismiss for this video" className="px-1.5 text-gray-400 hover:text-gray-700">✕</button>
            </div>
          </div>
          {quote && (
            <blockquote className="border-l-4 border-gray-300 pl-2 mb-2 text-xs text-gray-500 italic">“{quote}”</blockquote>
          )}
          <NoteWithActions
            note={note}
            myVote={myVotes.get(note.id)}
            onVote={handleVote}
            session={session}
            shareUrl={noteShareUrl(projectSlug, note.id)}
            onNeedLogin={onNeedLogin}
            onAuthored={recordAuthored}
          />
          {group.alternatives.length > 0 && (
            <div className="mt-3 pl-3 border-l-[3px] border-gray-300 space-y-3">
              {group.alternatives.map((d) => (
                <NoteWithActions
                  key={d.id}
                  note={d}
                  myVote={myVotes.get(d.id)}
                  onVote={handleVote}
                  session={session}
                  shareUrl={noteShareUrl(projectSlug, d.id)}
                  onNeedLogin={onNeedLogin}
                  onAuthored={recordAuthored}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
