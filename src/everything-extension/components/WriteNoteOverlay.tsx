import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ensureWebItem } from "../../everything-shared/ensureWebItem";
import { postClaimWithNote } from "../../everything-shared/postNote";
import type { PageItem } from "../../everything-shared/notesQuery";
import { PostAsCheckbox } from "../../everything-web/src/components/editorBits";
import { Modal } from "../../everything-web/src/components/Modal";
import { BUTTON, INPUT, QUOTE_RAIL } from "../../everything-shared/ui";
import { LoginPanel } from "./LoginPanel";

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
  const [error, setError] = useState<string | null>(null);
  // Bylines are opt-in, so a note is anonymous by default. That is how
  // Community Notes works on X. Nathan asked for this on 2026-07-14.
  const [signed, setSigned] = useState(false);

  const submit = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
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
    if (outcome.type === "error") return setError(outcome.message);
    onPosted();
    onClose();
  };

  return (
    <Modal title="Write a note" onClose={onClose} widthClassName="max-w-[35rem]">
        <blockquote className={`${QUOTE_RAIL} text-gray-600 dark:text-gray-300 italic text-sm`}>“{selection}”</blockquote>
        {!session ? (
          // Signing in happens right here in the overlay. Once the session
          // lands, this branch flips to the composer and the selection is
          // still in place.
          <LoginPanel surface="overlay" />
        ) : (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Write your correction"
              className={`w-full ${INPUT}`}
            />
            <div className="flex gap-2 items-center justify-end">
              <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="mr-auto" />
              <button onClick={submit} disabled={busy || note.trim().length < 10} className={BUTTON}>
                {busy ? "Posting…" : "Post draft note"}
              </button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}
