import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { CommentRow, NoteRow } from "../lib/types";
import type { Vote } from "../lib/votes";
import { deleteComment, postComment } from "../lib/comments";
import { isEarnestNote } from "../lib/judgeNote";
import { tallyVisible } from "../lib/noteScore";
import { displayName } from "../lib/session";
import { AutoGrowTextarea, PostAsCheckbox, RejectedNotice, useSignedByline } from "./editorBits";
import { MenuItem, TrashIcon } from "./NoteMenu";

/** Comment voting + authored-comment bookkeeping, owned by App and shared by
 *  every thread on the page. */
export interface CommentsApi {
  myVotes: Map<string, Vote>;
  onVote: (comment: CommentRow, vote: Vote) => void;
  /** Mirror the DB self-upvote of a just-posted comment into local state. */
  onAuthored: (commentId: string) => void;
}

/** Nesting is unlimited in data; the visual indent caps here so deep threads
 *  stay readable on mobile. */
const MAX_INDENT_DEPTH = 6;

/** Compact relative timestamp for comment meta ("now", "5m", "3h", "2d", then
 *  a short date). Comments are conversation — age matters, precision doesn't. */
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

/** Comments are secondary surface — votes shrink to icon chips (✓ ~ ✕) so the
 *  text stays the loudest thing in the thread. Same three-way scale and
 *  toggle/switch semantics as the note pills; labels live in tooltips/aria. */
const COMPACT_VOTES: { value: Vote; label: string; active: string; hover: string; icon: React.ReactNode }[] = [
  {
    value: 1, label: "Helpful",
    active: "bg-green-100 text-green-700 border-green-300",
    hover: "hover:bg-green-50 hover:text-green-700",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>,
  },
  {
    value: 0, label: "Somewhat helpful",
    active: "bg-amber-100 text-amber-700 border-amber-300",
    hover: "hover:bg-amber-50 hover:text-amber-700",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M2.5 9c1.8-2.6 3.7-2.6 5.5 0s3.7 2.6 5.5 0" /></svg>,
  },
  {
    value: -1, label: "Not helpful",
    active: "bg-red-100 text-red-700 border-red-300",
    hover: "hover:bg-red-50 hover:text-red-700",
    icon: <svg {...VOTE_ICON_PROPS} aria-hidden><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>,
  },
];

function CompactVoteRatings({ comment, myVote, onVote }: {
  comment: CommentRow;
  myVote: Vote | undefined;
  onVote: (vote: Vote) => void;
}) {
  const counts: Record<Vote, number> = {
    1: comment.helpful_count,
    0: comment.somewhat_helpful_count,
    [-1]: comment.not_helpful_count,
  };
  // Same rule as the note pills: tallies show once you've voted or the
  // comment has aged past the reveal window.
  const showCounts = tallyVisible(myVote, comment.created_at);
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

/** ⋯ overflow on your own comments — destructive Delete lives here, one step
 *  removed from a stray tap (mirrors the note card's own-menu pattern). */
function OwnCommentMenu({ onDelete }: { onDelete: () => void }) {
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
        aria-label="Comment actions"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center h-6 w-6 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 leading-none"
      >
        ⋯
      </button>
      {open && (
        <div className="cn-menu absolute left-0 top-7 z-20 w-44 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 text-sm">
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} icon={<TrashIcon />} label="Delete" danger />
        </div>
      )}
    </span>
  );
}

/** The note's comment thread: top-level comments are written from the
 *  post-vote donation box; replies nest Reddit-style beneath them. Collapsed
 *  by default —
 *  the header row is the toggle. A cyclic parent chain (bad row) is simply
 *  unreachable from the top-level roots, so recursion is safe. */
export function CommentThread({ note, byParent, api, session, onNeedLogin }: {
  note: NoteRow;
  byParent: Map<string | null, CommentRow[]>;
  api: CommentsApi;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const topLevel = byParent.get(null) ?? [];
  if (topLevel.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-gray-200 space-y-4">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700 py-1"
      >
        <svg
          {...VOTE_ICON_PROPS}
          aria-hidden
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 3.5L11 8l-5 4.5" />
        </svg>
        {topLevel.length === 1 ? "1 comment" : `${topLevel.length} comments`}
      </button>
      {open && topLevel.map((c) => (
        <CommentNode key={c.id} comment={c} depth={0} note={note} byParent={byParent} api={api} session={session} onNeedLogin={onNeedLogin} />
      ))}
    </div>
  );
}

function CommentNode({ comment, depth, note, byParent, api, session, onNeedLogin }: {
  comment: CommentRow;
  depth: number;
  note: NoteRow;
  byParent: Map<string | null, CommentRow[]>;
  api: CommentsApi;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const children = byParent.get(comment.id) ?? [];
  const mine = !!session && session.user.id === comment.author_id;
  return (
    <div>
      <p className="text-xs text-gray-500">
        <span className="font-semibold text-gray-600">{comment.author_name ?? "anonymous"}</span>
        <span className="text-gray-400"> · {timeAgo(comment.created_at)}</span>
      </p>
      <p className="mt-0.5 text-sm text-gray-800 whitespace-pre-wrap">{comment.body}</p>
      <div className="mt-1 -ml-1.5 flex items-center gap-1">
        <CompactVoteRatings
          comment={comment}
          myVote={api.myVotes.get(comment.id)}
          onVote={(vote) => api.onVote(comment, vote)}
        />
        <button
          onClick={() => (session ? setReplying(true) : onNeedLogin())}
          className="inline-flex items-center h-6 px-1.5 rounded-full text-[11px] font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          Reply
        </button>
        {mine && <OwnCommentMenu onDelete={() => deleteComment(comment.id)} />}
      </div>
      {replying && session && (
        <ReplyComposer
          parent={comment}
          note={note}
          session={session}
          onAuthored={api.onAuthored}
          onClose={() => setReplying(false)}
        />
      )}
      {children.length > 0 && (
        <div
          className={`mt-3 space-y-3 ${depth < MAX_INDENT_DEPTH ? "pl-3 sm:pl-4 border-l-2 border-gray-200" : ""}`}
        >
          {children.map((c) => (
            <CommentNode key={c.id} comment={c} depth={depth + 1} note={note} byParent={byParent} api={api} session={session} onNeedLogin={onNeedLogin} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Reply to a comment (any depth). Earnest-gated like every text path; replies
 *  carry no vote, so they mint no donation. */
function ReplyComposer({ parent, note, session, onAuthored, onClose }: {
  parent: CommentRow;
  note: NoteRow;
  session: Session;
  onAuthored: (commentId: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useSignedByline();

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRejected(false);
    try {
      const earnest = await isEarnestNote(text.trim(), note.claim?.context_quote ?? note.note, parent.body);
      if (!earnest) return setRejected(true);
      const id = await postComment({
        noteId: note.id,
        parentCommentId: parent.id,
        body: text.trim(),
        authorId: session.user.id,
        authorName: signed ? displayName(session) : null,
      });
      if (!id) return setError("Could not post the reply — try again.");
      onAuthored(id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <AutoGrowTextarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setRejected(false);
        }}
        rows={2}
        autoFocus
        placeholder="Write a reply…"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 3}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Reply"}
        </button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancel</button>
        <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="ml-auto" />
      </div>
      {rejected && <RejectedNotice>That didn't look like a genuine reply — try again.</RejectedNotice>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
