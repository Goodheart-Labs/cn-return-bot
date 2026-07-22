import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { NnnRow } from "../../../everything-shared/types";
import type { Vote } from "../../../everything-shared/votes";
import { deleteNnn } from "../../../everything-shared/noteNotNeeded";
import { tallyVisible } from "../../../everything-shared/noteScore";
import { MenuItem, TrashIcon } from "./NoteMenu";

/** Entry voting + authored-entry bookkeeping, owned by App and shared by
 *  every list on the page. */
export interface NnnApi {
  myVotes: Map<string, Vote>;
  onVote: (entry: NnnRow, vote: Vote) => void;
  /** Mirror the DB self-upvote of a just-posted entry into local state. */
  onAuthored: (entryId: string) => void;
}

/** Compact relative timestamp for entry meta ("now", "5m", "3h", "2d", then
 *  a short date). Entries are conversation — age matters, precision doesn't. */
function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const VOTE_ICON_PROPS = {
  width: 12, height: 12, viewBox: "0 0 16 16",
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

/** Entries are secondary surface — votes shrink to icon chips (✓ ~ ✕) so the
 *  text stays the loudest thing in the list. Same three-way scale and
 *  toggle/switch semantics as the note pills; labels live in tooltips/aria. */
const COMPACT_VOTES: { value: Vote; label: string; active: string; hover: string; icon: React.ReactNode }[] = [
  {
    value: 1, label: "Helpful",
    active: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700",
    hover: "hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/40 dark:hover:text-green-400",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>,
  },
  {
    value: 0, label: "Somewhat helpful",
    active: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700",
    hover: "hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/40 dark:hover:text-amber-400",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M2.5 9c1.8-2.6 3.7-2.6 5.5 0s3.7 2.6 5.5 0" /></svg>,
  },
  {
    value: -1, label: "Not helpful",
    active: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700",
    hover: "hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>,
  },
];

function CompactVoteRatings({ entry, myVote, onVote }: {
  entry: NnnRow;
  myVote: Vote | undefined;
  onVote: (vote: Vote) => void;
}) {
  const counts: Record<Vote, number> = {
    1: entry.helpful_count,
    0: entry.somewhat_helpful_count,
    [-1]: entry.not_helpful_count,
  };
  // Same rule as the note pills: tallies show once you've voted or the
  // entry has aged past the reveal window.
  const showCounts = tallyVisible(myVote, entry.created_at);
  return (
    <span className="inline-flex items-center gap-0.5">
      {COMPACT_VOTES.map(({ value, label, active, hover, icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-pressed={myVote === value}
          aria-label={showCounts ? `${label}: ${counts[value]} ratings` : label}
          onClick={() => onVote(value)}
          className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-full border text-[11px] font-semibold transition-colors ${
            myVote === value ? active : `border-transparent text-gray-400 ${hover}`
          }`}
        >
          {icon}
          {showCounts && counts[value] > 0 && counts[value].toLocaleString("en-US")}
        </button>
      ))}
    </span>
  );
}

/** ⋯ overflow on your own entries — destructive Delete lives here, one step
 *  removed from a stray tap (mirrors the note card's own-menu pattern). */
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
      <button
        aria-label="Entry actions"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center h-6 w-6 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 leading-none"
      >
        ⋯
      </button>
      {open && (
        <div className="cn-menu absolute left-0 top-7 z-20 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-1.5 text-sm">
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} icon={<TrashIcon />} label="Delete" danger />
        </div>
      )}
    </span>
  );
}

/** The claim's "note not needed" arguments — the same flat list renders under
 *  every note card on that claim. Collapsed by default; the header row is the
 *  toggle. */
export function NoteNotNeeded({ entries, api, session }: {
  entries: NnnRow[]; // this claim's entries, oldest first (App pre-sorts)
  api: NnnApi;
  session: Session | null;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1"
      >
        <svg
          {...VOTE_ICON_PROPS}
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
          <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{entry.body}</p>
          <div className="mt-1 -ml-1.5 flex items-center gap-1">
            <CompactVoteRatings
              entry={entry}
              myVote={api.myVotes.get(entry.id)}
              onVote={(vote) => api.onVote(entry, vote)}
            />
            {!!session && session.user.id === entry.author_id && (
              <OwnEntryMenu onDelete={() => deleteNnn(entry.id)} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
