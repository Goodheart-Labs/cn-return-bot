import { useEffect, useRef, useState } from "react";
import { MAX_READER_NOTE_LENGTH } from "@cn/core/passageHighlights";
import { displayName } from "@cn/core/session";
import { useSession } from "@cn/features/auth/useSession";
import { Button } from "@cn/ui/Button";
import { Checkbox, Textarea } from "@cn/ui/Field";
import { Modal } from "@cn/ui/Modal";
import { useReader, type ReaderAnchor, type ReaderModule } from "../context";
import { DialogFooter, DialogQuote } from "../DialogParts";
import { noteCardId } from "./notes";
import { useNotePost } from "./passageQuestions";

/** A note shorter than this is almost certainly unfinished (the same rule as
 *  the shared composer). */
export const MIN_NOTE_LENGTH = 10;

function NoteDialog({ anchor }: { anchor: ReaderAnchor }) {
  const { item, scope, closeDialog, notify, reveal } = useReader();
  const { session } = useSession();
  const [text, setText] = useState("");
  const [signed, setSigned] = useState(false);
  const notePost = useNotePost(item);
  const form = useRef<HTMLFormElement>(null);
  // The modal moves focus to its first button when it opens, which happens
  // before this effect, so the text box takes focus here.
  useEffect(() => form.current?.querySelector("textarea")?.focus(), []);

  async function submit() {
    const posted = await notePost.post(anchor, text, signed);
    if (!posted) return;
    closeDialog();
    document.getSelection()?.removeAllRanges();
    notify("Your note is posted.");
    reveal(noteCardId(scope, posted.noteId), anchor.blockId);
  }

  return <Modal title="Add a note" onClose={closeDialog} widthClassName="max-w-[35rem]">
    <DialogQuote text={anchor.text} />
    <form ref={form} className="reader-dialog-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Textarea autoGrow aria-label="Your note" value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={MAX_READER_NOTE_LENGTH} placeholder="Add context, a correction, or a source for this passage." />
      {session && !session.user.is_anonymous && <Checkbox checked={signed} onChange={setSigned}>Post as {displayName(session)}</Checkbox>}
      {notePost.error && <p role="alert" className="reader-dialog-error">{notePost.error}</p>}
      <DialogFooter>
        <Button variant="quiet" onClick={closeDialog}>Cancel</Button>
        <Button type="submit" disabled={notePost.posting || text.trim().length < MIN_NOTE_LENGTH}>{notePost.posting ? "Posting…" : "Post note"}</Button>
      </DialogFooter>
    </form>
    {notePost.login}
  </Modal>;
}

function Dialogs() {
  const { dialog } = useReader();
  return dialog?.kind === "note" ? <NoteDialog key={dialog.anchor.blockId + dialog.anchor.text} anchor={dialog.anchor} /> : null;
}

/** Writing a note on the selected words. */
export const writeNoteModule: ReaderModule = {
  name: "writeNote",
  selectionActions: (api, block, quote) => [{
    feature: "highlight.note",
    key: "note",
    label: "Write note",
    accessibleName: "Write note on these words",
    onSelect: () => api.openDialog({ kind: "note", anchor: { blockId: block.id, text: quote, paragraph: block.text, partial: true } }),
  }],
  Dialogs,
};
