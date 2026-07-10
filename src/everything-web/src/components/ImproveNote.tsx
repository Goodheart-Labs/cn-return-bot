import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { submitImprovement } from "../lib/suggestions";

export function ImproveNote({ noteId, session, onNeedLogin }: {
  noteId: string;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <button onClick={onNeedLogin} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
        Suggest an improvement
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const accepted = await submitImprovement(noteId, text.trim());
      setOutcome(accepted ? "accepted" : "rejected");
      // Accepted edits replace the note above (via realtime), so close the editor.
      if (accepted) {
        setText("");
        setOpen(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Collapsed: a link, plus a one-line result after a submit.
  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={() => setOpen(true)} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
          Suggest an improvement
        </button>
        {outcome === "accepted" && <span className="text-sm text-green-700">Thanks — your version is now shown.</span>}
        {outcome === "rejected" && <span className="text-sm text-amber-700">That didn't look like a genuine improvement.</span>}
      </span>
    );
  }

  return (
    <div className="space-y-2 w-full">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Write a clearer or better-sourced version of this note…"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Sending…" : "Submit"}
        </button>
        <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">Cancel</button>
      </div>
      {outcome === "rejected" && (
        <p className="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200">
          That didn't look like a genuine improvement — try again.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
