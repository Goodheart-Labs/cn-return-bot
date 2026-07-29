import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../everything-shared/supabase";
import { displayName } from "../../../everything-shared/session";
import { postImprovement } from "../../../everything-shared/postNote";
import { postNnn } from "../../../everything-shared/noteNotNeeded";
import type { NoteRow } from "../../../everything-shared/types";
import { AutoGrowTextarea, PostAsCheckbox, RejectedNotice, useSignedByline } from "./editorBits";

/** One row of the ⋯ dropdown: muted icon, medium-weight label, rounded hover;
 *  danger rows go red with a red hover wash. */
export function MenuItem({ onClick, icon, label, danger, autoFocus }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  /** Focus on mount — the native focus-scroll is what reveals a menu that
   *  opens below the popover's fold (same snap the composers get from their
   *  autoFocus textarea; no separate scroll mechanism). */
  autoFocus?: boolean;
}) {
  const tone = danger
    ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
  return (
    <button
      onClick={onClick}
      autoFocus={autoFocus}
      className={`flex w-full items-center gap-2.5 text-left px-2.5 py-2 rounded-lg font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tone}`}
    >
      <span className={`shrink-0 ${danger ? "text-red-500" : "text-gray-400 dark:text-gray-500"}`} aria-hidden>{icon}</span>
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

function SpeechBubbleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** The note's action row: argue the claim needs no note, suggest an
 *  improvement (posts your own draft note on the same claim, shown alongside
 *  the original), share a deep link, and — on notes you wrote — a ⋯ menu with
 *  delete. */
export function NoteMenu({ note, shareUrl, session, onNeedLogin, onAuthored, onNnnAuthored, onDeleted, sourcesOpen, onToggleSources, children }: {
  note: NoteRow;
  /** Absolute deep link to this note (the website computes it from the project
   *  slug; the extension passes the public site's URL). */
  shareUrl: string;
  session: Session | null;
  onNeedLogin: () => void;
  /** A note was just posted by this user (mirror its auto-upvote locally). */
  onAuthored: (noteId: string) => void;
  /** A note-not-needed entry was just posted by this user (mirror its
   *  auto-upvote locally). */
  onNnnAuthored: (entryId: string) => void;
  /** The note was deleted. The website's realtime channel already removes it
   *  from state; the extension (no realtime) refreshes on this. */
  onDeleted?: () => void;
  sourcesOpen?: boolean;
  onToggleSources?: () => void;
  /** Extra actions slotted between Share and the ⋯ (e.g. improvement jump chips). */
  children?: React.ReactNode;
}) {
  // One expanded block at a time — the ⋯ menu and the two composers replace
  // each other (source details stay independent of this group). Drafts
  // survive switches: the editors unmount when hidden, so their text lives
  // here in the parent.
  const [expanded, setExpanded] = useState<"menu" | "improve" | "nnn" | null>(null);
  const [improveDraft, setImproveDraft] = useState("");
  const [nnnDraft, setNnnDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mine = !!session && session.user.id === note.author_id;

  // Close the menu when a press lands anywhere outside the action row —
  // including elsewhere on the note (composers stay put; only an explicit
  // action closes those). Capture phase + composedPath: the extension's
  // popover absorbs bubbling mousedowns so the host page never sees them,
  // which would also shield in-card clicks from a bubble-phase listener.
  useEffect(() => {
    if (expanded !== "menu") return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setExpanded(null);
    };
    document.addEventListener("mousedown", onDown, { capture: true });
    return () => document.removeEventListener("mousedown", onDown, { capture: true });
  }, [expanded]);

  const share = async () => {
    setExpanded((prev) => (prev === "menu" ? null : prev));
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const del = async () => {
    setExpanded(null);
    // The `.select()` echo distinguishes a real delete from an RLS
    // silently-matched-zero-rows no-op (only own draft notes are deletable).
    const { data, error } = await supabase.from("everything_notes").delete().eq("id", note.id).select("id");
    if (error || (data ?? []).length === 0) {
      console.error("[common-notes] note delete failed:", error?.message ?? "no row deleted (RLS: only your own draft notes)");
      return;
    }
    onDeleted?.();
  };
  const toggleImprove = () => {
    if (!session) return onNeedLogin();
    setExpanded((prev) => (prev === "improve" ? null : "improve"));
  };
  const toggleNnn = () => {
    if (!session) return onNeedLogin();
    setExpanded((prev) => (prev === "nnn" ? null : "nnn"));
  };
  // The source links sit inline on every card; this toggle only reveals the
  // per-source quote + explanation, so it appears only when a quote exists.
  const showSourcesButton = !!onToggleSources && note.sources.some((s) => s.quote);

  return (
    <div className="mt-1">
      <div ref={ref} className="relative flex flex-wrap justify-end items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {/* Sources + improve + share ride visibly on every card; the ⋯ menu
            only exists for delete on your own notes (Nathan, 2026-07-14 — the
            menu was hiding the whole improve flow). */}
        {showSourcesButton && (
          <button onClick={onToggleSources} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
            <QuoteIcon /> {sourcesOpen ? "Hide source details" : "Show source details"}
          </button>
        )}
        <button onClick={toggleNnn} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
          <SpeechBubbleIcon /> Note not needed
        </button>
        <button onClick={toggleImprove} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
          <PencilIcon /> Suggest an improvement
        </button>
        <button
          onClick={share}
          className={`inline-flex items-center gap-1 hover:underline ${copied ? "text-green-700 dark:text-green-400" : "text-blue-600 dark:text-blue-400"}`}
        >
          {copied ? "Link copied" : <><ShareIcon /> Share</>}
        </button>
        {children}
        {mine && (
          <button
            aria-label="Note actions"
            onClick={() => setExpanded((prev) => (prev === "menu" ? null : "menu"))}
            className="px-1.5 py-0.5 rounded text-base leading-none text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800"
          >
            ⋯
          </button>
        )}
        {expanded === "menu" && mine && (
          // In-flow (w-full wraps to its own line), NOT absolutely positioned:
          // in the extension the card sits in a max-h scroll popover, and a
          // dropdown hanging below the bottom action row spilled past the edge
          // — revealing a scrollbar instead of the menu. In-flow grows the
          // card, same as the improve/NNN composers.
          <div className="w-full flex justify-end mt-1">
            <div className="cn-menu w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-1.5 text-sm">
              <MenuItem onClick={del} icon={<TrashIcon />} label="Delete" danger autoFocus />
            </div>
          </div>
        )}
      </div>
      {expanded === "improve" && session && (
        <ImproveEditor note={note} session={session} text={improveDraft} onTextChange={setImproveDraft} onAuthored={onAuthored} onClose={() => setExpanded(null)} />
      )}
      {expanded === "nnn" && session && (
        <NnnComposer note={note} session={session} text={nnnDraft} onTextChange={setNnnDraft} onAuthored={onNnnAuthored} onClose={() => setExpanded(null)} />
      )}
    </div>
  );
}

/** Post a "note not needed" argument on the note's claim (ungated, like the
 *  plain discussion it replaces). Claim-keyed, so it shows under every note
 *  on the same text. */
function NnnComposer({ note, session, text, onTextChange, onAuthored, onClose }: {
  note: NoteRow;
  session: Session;
  text: string;
  onTextChange: (text: string) => void;
  onAuthored: (entryId: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useSignedByline();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const entryId = await postNnn({
        claimId: note.claim_id,
        body: text.trim(),
        authorId: session.user.id,
        authorName: signed ? displayName(session) : null,
      });
      if (!entryId) return setError("Could not post (try again)");
      onTextChange("");
      onAuthored(entryId);
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
        onChange={(e) => onTextChange(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Why does this claim need no note?"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Posting…" : "Post"}
        </button>
        <button onClick={onClose} className="text-sm text-gray-500 dark:text-gray-400 hover:underline">Cancel</button>
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
function ImproveEditor({ note, session, text, onTextChange, onAuthored, onClose }: {
  note: NoteRow;
  session: Session;
  text: string;
  onTextChange: (text: string) => void;
  onAuthored: (noteId: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useSignedByline();

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRejected(false);
    const outcome = await postImprovement({ note, text, session, signed });
    setBusy(false);
    if (outcome.type === "rejected") return setRejected(true);
    if (outcome.type === "error") return setError(outcome.message);
    onTextChange("");
    onAuthored(outcome.noteId);
    onClose();
  };

  return (
    <div className="mt-2 space-y-2">
      <AutoGrowTextarea
        value={text}
        onChange={(e) => { onTextChange(e.target.value); setRejected(false); }}
        rows={3}
        autoFocus
        placeholder="Write a clearer or better-sourced version"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Post note"}
        </button>
        <button onClick={onClose} className="text-sm text-gray-500 dark:text-gray-400 hover:underline">Cancel</button>
        <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="ml-auto" />
      </div>
      {rejected && <RejectedNotice />}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
