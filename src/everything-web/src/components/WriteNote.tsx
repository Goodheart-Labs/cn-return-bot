import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/** Best public-facing name for the signed-in user (X handle, name, or email
 *  local part — never the full email). */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return meta.user_name ?? meta.full_name ?? session.user.email?.split("@")[0] ?? "anonymous";
}

/** "Write your own note" — inserts a draft note on the claim, visible to
 *  everyone immediately (via realtime) and rated like any other note. */
export function WriteNote({ claimId, session, onNeedLogin }: {
  claimId: string;
  session: Session | null;
  onNeedLogin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <button onClick={onNeedLogin} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
        Write your own note
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase.from("everything_notes").insert({
      claim_id: claimId,
      note: text.trim(),
      author_id: session.user.id,
      author_name: displayName(session),
      status: "draft",
    });
    setBusy(false);
    if (insertError) return setError(insertError.message);
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-gray-500 hover:text-blue-600 hover:underline">
        Write your own note
      </button>
    );
  }

  return (
    <div className="space-y-2 w-full">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Write your own note on this claim — include sources as plain URLs…"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Posting…" : "Post draft note"}
        </button>
        <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">Cancel</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
