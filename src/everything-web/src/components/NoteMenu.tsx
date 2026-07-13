import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { noteUrl } from "../lib/routing";
import { displayName } from "../lib/session";
import { isEarnestNote } from "../lib/judgeNote";
import type { NoteRow } from "../lib/types";

/** One row of the ⋯ dropdown: muted icon, medium-weight label, rounded hover;
 *  danger rows go red with a red hover wash. */
function MenuItem({ onClick, icon, label, danger }: {
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

function TrashIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

/** Bottom-right ⋯ menu on every note: suggest an improvement (posts your own
 *  draft note on the same claim, shown alongside the original), share a deep
 *  link, and — on notes you wrote — delete. */
export function NoteMenu({ note, projectSlug, session, onNeedLogin }: {
  note: NoteRow;
  projectSlug: string;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [improving, setImproving] = useState(false);
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

  return (
    <div className="mt-1">
      <div ref={ref} className="relative flex justify-end items-center gap-2 text-xs text-gray-500">
        {copied && <span className="text-green-700">Link copied</span>}
        <button
          aria-label="Note actions"
          onClick={() => setOpen((o) => !o)}
          className="px-1.5 py-0.5 rounded text-base leading-none text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          ⋯
        </button>
        {open && (
          <div className="cn-menu absolute right-0 top-8 z-20 w-56 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 text-sm">
            <MenuItem onClick={startImprove} icon={<PencilIcon />} label="Suggest an improvement" />
            <MenuItem onClick={share} icon={<ShareIcon />} label="Share" />
            {mine && (
              <>
                <div className="my-1 border-t border-gray-100" aria-hidden />
                <MenuItem onClick={del} icon={<TrashIcon />} label="Delete" danger />
              </>
            )}
          </div>
        )}
      </div>
      {improving && session && (
        <ImproveEditor note={note} session={session} onClose={() => setImproving(false)} />
      )}
    </div>
  );
}

/** Post an improved version as your own draft note on the same claim. It shows
 *  next to the original (both are rated); it does not replace it. The judge-note
 *  edge function gates it earnest-vs-trolling before it posts. */
function ImproveEditor({ note, session, onClose }: {
  note: NoteRow;
  session: Session;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRejected(false);
    try {
      const earnest = await isEarnestNote(text.trim(), note.claim?.context_quote ?? "", note.note);
      if (!earnest) return setRejected(true);
      const { error } = await supabase.from("everything_notes").insert({
        claim_id: note.claim_id,
        note: text.trim(),
        author_id: session.user.id,
        author_name: displayName(session),
        status: "draft",
      });
      if (error) return setError(error.message);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setRejected(false); }}
        rows={3}
        autoFocus
        placeholder="Write a clearer or better-sourced version — it posts as your own note on this claim…"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
      </div>
      {rejected && (
        <p className="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200">
          That didn't look like a genuine note — try again.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
