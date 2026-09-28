import { useRef, useState } from "react";
import { tallyVisible } from "@cn/core/noteScore";
import type { NnnRow } from "@cn/core/types";
import { cn } from "@cn/ui/cn";
import { ChevronIcon, MoreIcon, TrashIcon } from "@cn/ui/icons";
import { Menu, MenuItem } from "@cn/ui/Menu";
import { eyebrowVariants } from "@cn/ui/typography";
import { IconButton } from "@cn/ui/IconButton";
import { useOutsidePress } from "@cn/ui/useOutsidePress";
import { useSession } from "../auth/useSession";
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

function OwnEntryMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useOutsidePress(ref, open, () => setOpen(false));
  return (
    <span ref={ref} className="relative">
      <IconButton label="Entry actions" onClick={() => setOpen((o) => !o)}>
        <MoreIcon size={16} aria-hidden />
      </IconButton>
      {open && (
        <Menu className="absolute left-0 top-7 z-20">
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} icon={<TrashIcon size={16} />} danger autoFocus>Delete</MenuItem>
        </Menu>
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
    <div className="mt-3 pt-2 border-t border-line space-y-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(eyebrowVariants(), "flex items-center gap-1.5 py-1 hover:text-fg-secondary")}
      >
        <ChevronIcon size={12} aria-hidden className={cn("transition-transform", open && "rotate-90")} />
        Note not needed ({entries.length})
      </button>
      {open && entries.map((entry) => (
        <div key={entry.id}>
          <p className="text-xs text-fg-muted">
            <span className="font-semibold text-fg-secondary">{entry.author_name ?? "anonymous"}</span>
            <span className="text-fg-subtle"> · {timeAgo(entry.created_at)}</span>
          </p>
          <p className="mt-1 text-sm text-fg whitespace-pre-wrap">{entry.body}</p>
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
