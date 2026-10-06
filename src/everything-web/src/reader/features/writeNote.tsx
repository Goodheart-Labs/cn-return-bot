import { useState } from "react";
import { ensureSession } from "@cn/core/auth";
import { anchorForSelection, type ReaderBlock } from "@cn/core/readerText";
import { displayName } from "@cn/core/session";
import { useSession } from "@cn/features/auth/useSession";
import { usePostClaimWithNote } from "@cn/features/notes/useNoteWrites";
import { Button } from "@cn/ui/Button";
import { Checkbox, Textarea } from "@cn/ui/Field";
import { Modal } from "@cn/ui/Modal";
import { LoginModal } from "../../components/LoginModal";
import { useReader, type ReaderAnchor, type ReaderModule } from "../context";
import { DialogFooter, DialogQuote } from "../DialogParts";
import { noteCardId } from "./notes";

/** A note shorter than this is almost certainly unfinished (the same rule as
 *  the shared composer). */
const MIN_NOTE_LENGTH = 10;
/** The database refuses a reader's note longer than this (migration 114). */
const MAX_NOTE_LENGTH = 2000;

function NoteDialog({ anchor }: { anchor: ReaderAnchor }) {
  const { item, scope, closeDialog, notify, reveal } = useReader();
  const { session } = useSession();
  const [text, setText] = useState("");
  const [signed, setSigned] = useState(false);
  const [login, setLogin] = useState(false);
  const post = usePostClaimWithNote();

  // The invisible account is made when the reader posts, not when the dialog
  // opens, so opening and cancelling leaves nothing behind.
  async function submit() {
    const current = await ensureSession();
    if (!current) { setLogin(true); return; }
    post.mutate(
      { item, page: { url: item.url, title: item.title ?? "" }, anchorText: anchor.text, contextParagraph: anchor.paragraph, note: text, session: current, signed: signed && !current.user.is_anonymous },
      {
        onSuccess: (result) => {
          closeDialog();
          document.getSelection()?.removeAllRanges();
          notify("Your note is posted.");
          reveal(noteCardId(scope, result.noteId), anchor.blockId);
        },
      },
    );
  }

  if (login) return <LoginModal open onClose={() => setLogin(false)} />;
  return <Modal title="Add a note" onClose={closeDialog} widthClassName="max-w-[35rem]">
    <DialogQuote label={anchor.partial ? "On the words you selected" : "On this passage"} text={anchor.text} />
    <form className="reader-dialog-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Textarea autoGrow autoFocus aria-label="Your note" value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={MAX_NOTE_LENGTH} placeholder="Add context, a correction, or a source for this passage." />
      {session && !session.user.is_anonymous && <Checkbox checked={signed} onChange={setSigned}>Post as {displayName(session)}</Checkbox>}
      {post.isError && <p role="alert" className="reader-dialog-error">That didn't post. Check your connection and try again.</p>}
      <DialogFooter>
        <Button variant="quiet" onClick={closeDialog}>Cancel</Button>
        <Button type="submit" disabled={post.isPending || text.trim().length < MIN_NOTE_LENGTH}>{post.isPending ? "Posting…" : "Post note"}</Button>
      </DialogFooter>
    </form>
  </Modal>;
}

function Dialogs() {
  const { dialog } = useReader();
  return dialog?.kind === "note" ? <NoteDialog key={dialog.anchor.blockId + dialog.anchor.text} anchor={dialog.anchor} /> : null;
}

const passageAnchor = (block: ReaderBlock): ReaderAnchor => ({ blockId: block.id, text: block.text, paragraph: block.text, partial: false });

/** Writing notes: on the selected words, and on a whole passage. */
export const writeNoteModule: ReaderModule = {
  name: "writeNote",
  selectionActions: (api, block, quote) => [{
    feature: "highlight.note",
    key: "note",
    label: "Note",
    accessibleName: "Add a note on these words",
    onSelect: () => api.openDialog({ kind: "note", anchor: { blockId: block.id, text: quote, paragraph: block.text, partial: true } }),
  }],
  // A passage too short to anchor a note offers no button.
  passageActions: (api, block) => (anchorForSelection(block, block.text) ? [{
    feature: "passage.note",
    key: "note",
    label: "Add a note",
    accessibleName: `Add a note on this passage: ${block.text.slice(0, 60)}`,
    onSelect: () => api.openDialog({ kind: "note", anchor: passageAnchor(block) }),
  }] : []),
  Dialogs,
};
