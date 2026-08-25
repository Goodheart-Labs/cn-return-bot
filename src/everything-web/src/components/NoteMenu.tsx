import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../../everything-shared/supabase";
import { displayName } from "../../../everything-shared/session";
import { postImprovement } from "../../../everything-shared/postNote";
import { track } from "../../../everything-shared/analytics";
import { postNnn } from "../../../everything-shared/noteNotNeeded";
import type { NoteRow } from "../../../everything-shared/types";
import { AutoGrowTextarea, PostAsCheckbox, RejectedNotice, useSignedByline } from "./editorBits";

/** One row of the ⋯ dropdown menu. A row marked as danger turns red, which is
 *  how a destructive action such as Delete is set apart from the rest. */
export function MenuItem({ onClick, icon, label, danger, autoFocus }: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  /** Focus this row as soon as it mounts. The browser scrolls a newly focused
   *  element into view, and that is what reveals a menu opening below the fold
   *  of the extension's popover. There is no separate scrolling code. The two
   *  composers get the same effect from their auto-focused textarea. */
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

/** The row of actions under a note. You can argue that the claim needs no note.
 *  You can suggest an improvement, which posts your rewrite as your own draft
 *  note on the same claim and shows it beside the original. You can copy a deep
 *  link to the note. On a note you wrote yourself there is also a ⋯ menu, and
 *  it holds Delete. */
export function NoteMenu({ note, shareUrl, session, onNeedLogin, onAuthored, onNnnAuthored, onDeleted, sourcesOpen, onToggleSources, children }: {
  note: NoteRow;
  /** The absolute deep link to this note. The website builds it from the
   *  project slug. The extension passes the public site's URL instead. */
  shareUrl: string;
  session: Session | null;
  onNeedLogin: () => void;
  /** Called when this user has just posted a note. The database casts the
   *  author's own helpful vote by trigger, and this mirrors it into local
   *  state. */
  onAuthored: (noteId: string) => void;
  /** Called when this user has just posted a note-not-needed entry. It mirrors
   *  the author's automatic helpful vote into local state. */
  onNnnAuthored: (entryId: string) => void;
  /** Called after the note was deleted. The website does not need it, because
   *  its realtime channel already drops the note from state. The extension has
   *  no realtime connection, so it refreshes when this fires. */
  onDeleted?: () => void;
  sourcesOpen?: boolean;
  onToggleSources?: () => void;
  /** Extra actions rendered between Share and the ⋯ button. The feed uses this
   *  for the chips that jump between a note and its improvement. */
  children?: React.ReactNode;
}) {
  /* Only one block is expanded at a time. The ⋯ menu and the two composers
   * replace each other. The source details toggle is not part of this group and
   * opens on its own. A hidden editor unmounts, so its draft text is held here
   * in the parent and survives a switch to the other composer. */
  const [expanded, setExpanded] = useState<"menu" | "improve" | "nnn" | null>(null);
  const [improveDraft, setImproveDraft] = useState("");
  const [nnnDraft, setNnnDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mine = !!session && session.user.id === note.author_id;

  /* Close the ⋯ menu when a press lands anywhere outside the action row, which
   * includes the rest of the note. The composers are not closed this way. Only
   * an explicit action closes those. The listener runs in the capture phase and
   * checks composedPath, because the extension's popover swallows bubbling
   * mousedown events so the host page never sees them. A bubble-phase listener
   * would therefore never learn about a press inside the card either. */
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
    /* Asking for the deleted ids back tells a real delete apart from one that
     * matched no rows. Row level security only lets you delete your own draft
     * notes, and a delete it blocks still succeeds, just with zero rows. */
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
  // Every card already shows its source links. This toggle only reveals the
  // quote and explanation for each source, so it appears only if a quote exists.
  const showSourcesButton = !!onToggleSources && note.has_source_details;

  return (
    <div className="mt-1">
      <div ref={ref} className="relative flex flex-wrap justify-end items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {/* The sources, improve and share actions are visible on every card.
            The ⋯ menu only holds Delete, and only on your own notes. Nathan
            moved the other actions out of it on 2026-07-14, because the menu
            was hiding the whole improvement flow. */}
        {showSourcesButton && (
          <button onClick={onToggleSources} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
            <QuoteIcon /> {sourcesOpen ? "Hide source details" : "Show source details"}
          </button>
        )}
        <button onClick={toggleNnn} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
          <SpeechBubbleIcon /> Note not needed
        </button>
        {/* Improving your own note makes no sense as a second card beside it.
            An author who wants different wording deletes and rewrites. */}
        {!mine && (
          <button onClick={toggleImprove} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
            <PencilIcon /> Suggest an improvement
          </button>
        )}
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
          /* The menu sits in the normal flow and wraps onto its own line. It is
           * deliberately not positioned absolutely. In the extension the card
           * lives inside a scrolling popover with a maximum height, and a
           * dropdown hanging below the action row spilled past that edge. The
           * reader then saw a scrollbar instead of the menu. Sitting in the
           * flow grows the card instead, the same way the two composers do. */
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

/** Post an argument that the note's claim needs no note at all. The earnest
 *  gate does not apply here, just as it did not apply to the discussion this
 *  replaced. The entry is stored against the claim, so it shows under every
 *  note written on that same text. */
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

/** Post an improved version as your own draft note on the same claim. It does
 *  not replace the original. It appears as its own card with jump links to and
 *  from the original, and both notes are rated separately. The judge-note edge
 *  function checks that the text is a genuine attempt before it is posted. */
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
    if (outcome.type === "rejected") {
      // The earnest-gate judge stores nothing, so rejections exist only as events.
      track("improvement_write_rejected", { note_id: note.id });
      return setRejected(true);
    }
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
