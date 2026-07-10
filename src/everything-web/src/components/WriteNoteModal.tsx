import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { ClaimRef } from "../lib/types";

/** Best public-facing name for the signed-in user (X handle, name, or email
 *  local part — never the full email). */
function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return meta.user_name ?? meta.full_name ?? session.user.email?.split("@")[0] ?? "anonymous";
}

/** Global "Write a note" flow: pick which claim you're noting (dropdown of
 *  quotes from the current project), write, post as a draft. */
export function WriteNoteModal({ open, onClose, claims, session }: {
  open: boolean;
  onClose: () => void;
  claims: ClaimRef[];
  session: Session;
}) {
  const [claimId, setClaimId] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  const selectedClaim = claimId || claims[0]?.id || "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase.from("everything_notes").insert({
      claim_id: selectedClaim,
      note: text.trim(),
      author_id: session.user.id,
      author_name: displayName(session),
      status: "draft",
    });
    setBusy(false);
    if (insertError) return setError(insertError.message);
    setText("");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <form
        onSubmit={submit}
        className="bg-white rounded-xl p-6 w-full max-w-lg space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Write a note</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <label className="block text-xs text-gray-500">
          On which claim?
          <select
            value={selectedClaim}
            onChange={(e) => setClaimId(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm text-gray-800"
          >
            {claims.map((c) => (
              <option key={c.id} value={c.id}>
                {c.claim.length > 90 ? `${c.claim.slice(0, 90)}…` : c.claim}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Write your note — include sources as plain URLs…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex gap-2 items-center justify-end">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancel</button>
          <button
            type="submit"
            disabled={busy || text.trim().length < 10 || !selectedClaim}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? "Posting…" : "Post draft note"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
