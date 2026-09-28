import { useEffect, useRef, useState } from "react";
import { tallyVisible } from "@cn/core/noteScore";
import type { NnnRow } from "@cn/core/types";
import { EYEBROW, MENU } from "@cn/ui/classes";
import { IconButton } from "@cn/ui/IconButton";
import { useSession } from "../auth/useSession";
import { MenuItem, TrashIcon } from "./NoteMenu";
import { useDeleteNnn } from "./useNoteWrites";
import { useMyNnnVotes, useVoteOnNnn } from "./useVotes";
import { VoteRatings } from "./VoteRatings";

/** A short relative timestamp for an entry, such as "now", "5m", "3h" or "2d".
 *  Anything older than a month shows a short date instead. Entries read as
 *  conversation, so a rough age is enough and an exact time would be noise. */
function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* The header row's little chevron. The vote chips draw their own icons inside
 * the shared VoteRatings component. */
const CHEVRON_ICON_PROPS = {
  width: 12, height: 12, viewBox: "0 0 14 14",
  fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

function OwnEntryMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <span ref={ref} className="relative">
      <IconButton label="Entry actions" onClick={() => setOpen((o) => !o)}>
        <span className="text-base leading-none">⋯</span>
      </IconButton>
      {open && (
        <div className={`absolute left-0 top-7 z-20 ${MENU}`}>
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} icon={<TrashIcon />} label="Delete" danger autoFocus />
        </div>
      )}
    </span>
  );
}

/** The arguments that a claim needs no note. The list is flat, and the same
 *  list renders under every note card on that claim. It starts collapsed, and
 *  the header row is the toggle. */
export function NoteNotNeeded({ entries }: {
  entries: NnnRow[]; // This claim's entries, oldest first.
}) {
  const [open, setOpen] = useState(false);
  const { session } = useSession();
  const myVotes = useMyNnnVotes();
  const voteOnEntry = useVoteOnNnn();
  const deleteEntry = useDeleteNnn();
  if (entries.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 py-1 ${EYEBROW} hover:text-gray-700 dark:hover:text-gray-300`}
      >
        <svg
          {...CHEVRON_ICON_PROPS}
          aria-hidden
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 3.5L11 8l-5 4.5" />
        </svg>
        Note not needed ({entries.length})
      </button>
      {open && entries.map((entry) => (
        <div key={entry.id}>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-600 dark:text-gray-300">{entry.author_name ?? "anonymous"}</span>
            <span className="text-gray-400"> · {timeAgo(entry.created_at)}</span>
          </p>
          <p className="mt-1 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{entry.body}</p>
          <div className="mt-1 -ml-2 flex items-center gap-1">
            <VoteRatings
              compact
              helpful={entry.helpful_count}
              somewhatHelpful={entry.somewhat_helpful_count}
              notHelpful={entry.not_helpful_count}
              myVote={myVotes.get(entry.id)}
              showCounts={tallyVisible(myVotes.get(entry.id), entry.created_at)}
              onVote={(vote) => void voteOnEntry(entry, vote)}
            />
            {!!session && session.user.id === entry.author_id && (
              <OwnEntryMenu onDelete={() => deleteEntry.mutate(entry.id)} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
