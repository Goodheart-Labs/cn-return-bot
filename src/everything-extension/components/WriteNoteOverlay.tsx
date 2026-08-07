import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { displayName } from "../../everything-shared/session";
import { ensureWebItem } from "../../everything-shared/ensureWebItem";
import { postClaimWithNote } from "../../everything-shared/postNote";
import type { PageItem } from "../../everything-shared/notesQuery";
import { RejectedNotice } from "../../everything-web/src/components/editorBits";

/** Write a note anchored to the reader's selection. This is the extension's
 *  version of the website's WriteNoteModal. On the website you search the
 *  transcript for the passage. Here the reader has already selected the
 *  passage on the page itself.
 *  An uncovered page has no item row yet, so `item` is null. In that case
 *  `pageForItem` carries what an item needs, and the item is only created
 *  when the note is actually posted. An overlay the reader closes again
 *  therefore leaves no orphan item behind. */
export function WriteNoteOverlay({ item, pageForItem, selection, session, onClose, onPosted }: {
  item: PageItem | null;
  pageForItem?: { url: string; title: string };
  selection: string;
  session: Session | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bylines are opt-in, so a note is anonymous by default. That is how
  // Community Notes works on X. Nathan asked for this on 2026-07-14.
  const [signed, setSigned] = useState(false);

  const submit = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setRejected(false);
    let itemId = item?.id;
    let itemUrl = item?.url;
    if (!itemId) {
      if (!pageForItem) return;
      try {
        itemId = await ensureWebItem(pageForItem);
        itemUrl = pageForItem.url;
      } catch (err) {
        setBusy(false);
        return setError((err as Error).message);
      }
    }
    const outcome = await postClaimWithNote({
      itemId,
      itemUrl: itemUrl!,
      anchorText: selection,
      note,
      session,
      signed,
    });
    setBusy(false);
    if (outcome.type === "rejected") return setRejected(true);
    if (outcome.type === "error") return setError(outcome.message);
    onPosted();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-700 rounded-xl p-5 w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">Write a note</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
        </div>
        <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 text-gray-600 dark:text-gray-300 italic text-sm">“{selection}”</blockquote>
        {!session ? (
          <p className="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900">
            Sign in from the Common Notes toolbar icon to write notes.
          </p>
        ) : (
          <>
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setRejected(false); }}
              rows={4}
              autoFocus
              placeholder="Write your correction"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm"
            />
            {rejected && <RejectedNotice />}
            <div className="flex gap-2 items-center justify-end">
              <label className="mr-auto flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
                Post as {displayName(session)}
              </label>
              <button
                onClick={submit}
                disabled={busy || note.trim().length < 10}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                {busy ? "Checking…" : "Post draft note"}
              </button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
