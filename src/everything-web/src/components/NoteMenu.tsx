import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { noteUrl } from "../lib/routing";
import { displayName } from "../lib/session";
import { isEarnestNote } from "../lib/judgeNote";
import { postComment } from "../lib/comments";
import type { NoteRow } from "../lib/types";
import { AutoGrowTextarea, PostAsCheckbox, RejectedNotice, useSignedByline } from "./editorBits";

/** One row of the ⋯ dropdown: muted icon, medium-weight label, rounded hover;
 *  danger rows go red with a red hover wash. */
export function MenuItem({ onClick, icon, label, danger }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  const tone = danger
    ? "text-red-600 hover:bg-red-50"
    : "text-gray-700 hover:bg-gray-100";
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 text-left px-2.5 py-2 rounded-lg font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tone}`}
    >
      <span className={`shrink-0 ${danger ? "text-red-500" : "text-gray-400"}`} aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

const ICON_PROPS = {
  width: 16, height: 16, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

function PencilIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 15V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** The note's action row: write a comment, suggest an improvement (posts your
 *  own draft note on the same claim, shown alongside the original), share a
 *  deep link, and — on notes you wrote — a ⋯ menu with delete. */
export function NoteMenu({ note, projectSlug, session, onNeedLogin, onAuthored, onCommentAuthored, sourcesOpen, onToggleSources, children }: {
  note: NoteRow;
  projectSlug: string;
  session: Session | null;
  onNeedLogin: () => void;
  /** A note was just posted by this user (mirror its auto-upvote locally). */
  onAuthored: (noteId: string) => void;
  /** A comment was just posted by this user (mirror its auto-upvote locally). */
  onCommentAuthored: (commentId: string) => void;
  sourcesOpen?: boolean;
  onToggleSources?: () => void;
  /** Extra actions slotted between Share and the ⋯ (e.g. improvement jump chips). */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [improving, setImproving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mine = !!session && session.user.id === note.author_id;

  // Close the menu on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const share = async () => {
    setOpen(false);
    await navigator.clipboard.writeText(noteUrl(projectSlug, note.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const del = async () => {
    setOpen(false);
    await supabase.from("everything_notes").delete().eq("id", note.id);
  };
  const startImprove = () => {
    setOpen(false);
    if (!session) return onNeedLogin();
    setImproving(true);
  };
  const startComment = () => {
    setOpen(false);
    if (!session) return onNeedLogin();
    setCommenting(true);
  };
  // The source links sit inline on every card; this toggle only reveals the
  // per-source quote + explanation, so it appears only when a quote exists.
  const showSourcesButton = !!onToggleSources && note.sources.some((s) => s.quote);

  return (
    <div className="mt-1">
      <div ref={ref} className="relative flex flex-wrap justify-end items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        {copied && <span className="text-green-700">Link copied</span>}
        {/* Sources + improve + share ride visibly on every card; the ⋯ menu
            only exists for delete on your own notes (Nathan, 2026-07-14 — the
            menu was hiding the whole improve flow). */}
        {showSourcesButton && (
          <button onClick={onToggleSources} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
            <QuoteIcon /> {sourcesOpen ? "Hide source details" : "Show source details"}
          </button>
        )}
        <button onClick={startComment} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          <CommentIcon /> Write a comment
        </button>
        <button onClick={startImprove} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          <PencilIcon /> Suggest an improvement
        </button>
        <button onClick={share} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          <ShareIcon /> Share
        </button>
        {children}
        {mine && (
          <button
            aria-label="Note actions"
            onClick={() => setOpen((o) => !o)}
            className="px-1.5 py-0.5 rounded text-base leading-none text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            ⋯
          </button>
        )}
        {open && mine && (
          <div className="cn-menu absolute right-0 top-8 z-20 w-56 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 text-sm">
            <MenuItem onClick={del} icon={<TrashIcon />} label="Delete" danger />
          </div>
        )}
      </div>
      {improving && session && (
        <ImproveEditor note={note} session={session} onAuthored={onAuthored} onClose={() => setImproving(false)} />
      )}
      {commenting && session && (
        <CommentEditor note={note} session={session} onAuthored={onCommentAuthored} onClose={() => setCommenting(false)} />
      )}
    </div>
  );
}

/** Post a public top-level comment on the note (ungated — comments stopped
 *  being donation-bearing vote reasoning, they're just discussion). */
function CommentEditor({ note, session, onAuthored, onClose }: {
  note: NoteRow;
  session: Session;
  onAuthored: (commentId: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useSignedByline();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const commentId = await postComment({
        noteId: note.id,
        body: text.trim(),
        authorId: session.user.id,
        authorName: signed ? displayName(session) : null,
      });
      if (!commentId) return setError("Could not post the comment — try again.");
      onAuthored(commentId);
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
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Write a comment about this note…"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Posting…" : "Post comment"}
        </button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancel</button>
        <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="ml-auto" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Post an improved version as your own draft note on the same claim. It shows
 *  as its own card, jump-linked to the original (both are rated); it does not
 *  replace it. The judge-note edge function gates it earnest-vs-trolling
 *  before it posts. */
function ImproveEditor({ note, session, onAuthored, onClose }: {
  note: NoteRow;
  session: Session;
  onAuthored: (noteId: string) => void;
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
      const earnest = await isEarnestNote(text.trim(), note.claim?.context_quote ?? "", note.note);
      if (!earnest) return setRejected(true);
      const { data, error } = await supabase.from("everything_notes").insert({
        claim_id: note.claim_id,
        note: text.trim(),
        author_id: session.user.id,
        author_name: signed ? displayName(session) : null,
        improved_from_note_id: note.id,
        status: "draft",
      }).select("id").single();
      if (error) return setError(error.message);
      onAuthored((data as { id: string }).id);
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
        onChange={(e) => { setText(e.target.value); setRejected(false); }}
        rows={3}
        autoFocus
        placeholder="Write a clearer or better-sourced version — it posts as your own note on this claim…"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Post note"}
        </button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancel</button>
        <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="ml-auto" />
      </div>
      {rejected && <RejectedNotice />}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
