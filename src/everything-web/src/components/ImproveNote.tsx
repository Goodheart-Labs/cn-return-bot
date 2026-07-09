import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { submitImprovement, type JudgeResult } from "../lib/suggestions";

export function ImproveNote({ noteId, session, onNeedLogin }: {
  noteId: string;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <button onClick={onNeedLogin} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
        Suggest an improvement
      </button>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
        Suggest an improvement
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await submitImprovement(noteId, text.trim());
      setResult(r);
      if (r.status === "accepted") setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
      {result && (
        <p className={`text-sm rounded-lg p-2 ${result.status === "accepted" ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
          {result.status === "accepted" ? "Accepted — thanks!" : "Not accepted."} {result.reason}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
