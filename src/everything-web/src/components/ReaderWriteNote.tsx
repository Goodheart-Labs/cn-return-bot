import { useEffect, useState } from "react";
import { ensureUser } from "../../../everything-shared/auth";
import type { PageItem } from "../../../everything-shared/notesQuery";
import { postClaimWithNote } from "../../../everything-shared/postNote";
import { supabase } from "../../../everything-shared/supabase";
import { BUTTON, QUOTE_RAIL } from "../../../everything-shared/ui";
import { AutoGrowTextarea, PostAsCheckbox, useSignedByline } from "./editorBits";
import { LoginModal } from "./LoginModal";
import { Modal } from "./Modal";
import { useReaderNotes } from "./ReaderNotes";

/** What a new note on the reading page is attached to. */
export interface ReaderAnchor {
  blockId: string;
  /** The words the note is about: the reader's selection, or the whole passage. */
  text: string;
  /** The whole passage, stored beside the anchor so the note can be placed
   *  even when the anchored words recur elsewhere in the essay. */
  paragraph: string;
  /** Whether `text` is a selection narrower than the passage. */
  partial: boolean;
}

const MIN_NOTE_CHARS = 10;

/** The reading page's composer. It is the website's counterpart of the
 *  extension's WriteNoteOverlay: the reader has already chosen the passage,
 *  so the modal shows it, takes the note, and posts through the same shared
 *  call the extension uses. The note posts as a draft and appears beside the
 *  passage marked "Needs more ratings", exactly like a note written through
 *  the extension.
 *
 *  A reader with no session gets an invisible anonymous account, as voting
 *  does. The sign-in form appears only when that is refused, which is the
 *  case in a browser that has held a real account before. */
export function ReaderWriteNote({ item, anchor, onClose, onPosted }: {
  item: PageItem;
  anchor: ReaderAnchor;
  onClose: () => void;
  onPosted: (noteId: string) => void;
}) {
  const { session, onChanged } = useReaderNotes();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useSignedByline();
  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    if (session) {
      setNeedLogin(false);
      return;
    }
    let cancelled = false;
    void ensureUser().then((user) => {
      if (!cancelled && !user) setNeedLogin(true);
    });
    return () => { cancelled = true; };
  }, [session]);

  // The sign-in modal closes both after a successful code and on cancel. Only
  // a cancel closes the composer; a sign-in returns the reader to it with the
  // passage still chosen.
  const closeLogin = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) setNeedLogin(false);
    else onClose();
  };

  if (!session && needLogin) return <LoginModal open onClose={() => void closeLogin()} />;

  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await postClaimWithNote({
      itemId: item.id,
      itemUrl: item.url,
      anchorText: anchor.text,
      contextParagraph: anchor.paragraph,
      note,
      session,
      signed,
    });
    setBusy(false);
    if (outcome.type === "error") return setError(outcome.message);
    onChanged();
    onPosted(outcome.noteId);
  };

  return (
    <Modal title="Add a note" onClose={onClose} widthClassName="max-w-[35rem]">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {anchor.partial ? "On the words you selected" : "On this passage"}
      </p>
      <blockquote className={`${QUOTE_RAIL} max-h-40 overflow-y-auto text-sm italic text-gray-600 dark:text-gray-300`}>
        “{anchor.text}”
      </blockquote>
      {session ? (
        <>
          <AutoGrowTextarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Add context, a correction, or a source for this passage."
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Your note appears beside the passage as “Needs more ratings” until other readers rate it.
          </p>
          <div className="flex items-center justify-end gap-2">
            {/* An anonymous account has no name to post as. */}
            {!session.user.is_anonymous && <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="mr-auto" />}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || note.trim().length < MIN_NOTE_CHARS}
              className={BUTTON}
            >
              {busy ? "Posting…" : "Post note"}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400" role="status">Preparing your note…</p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
    </Modal>
  );
}
