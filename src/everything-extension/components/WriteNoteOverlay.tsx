import { useEffect, useState } from "react";
import { ensureUser } from "@cn/core/auth";
import type { PageItem } from "@cn/core/items";
import { Quote } from "@cn/ui/typography";
import { Modal } from "@cn/ui/Modal";
import { useSession } from "@cn/features/auth/useSession";
import { Composer } from "@cn/features/notes/Composer";
import { usePostClaimWithNote } from "@cn/features/notes/useNoteWrites";
import { LoginPanel } from "./LoginPanel";

/** Write a note anchored to the reader's selection. This is the extension's
 *  version of the website's WriteNoteModal. On the website you search the
 *  transcript for the passage. Here the reader has already selected the
 *  passage on the page itself.
 *  An uncovered page has no item row yet, so `item` is null. In that case
 *  `pageForItem` carries what an item needs, and the item is only created
 *  when the note is actually posted. An overlay the reader closes again
 *  therefore leaves no orphan item behind. */
export function WriteNoteOverlay({ item, pageForItem, selection, onClose, onPosted }: {
  item: PageItem | null;
  pageForItem?: { url: string; title: string };
  selection: string;
  onClose: () => void;
  /** Called once the note is saved. The notes on screen refresh by themselves;
   *  an uncovered page uses this to switch to the full notes view. */
  onPosted?: () => void;
}) {
  const { session } = useSession();
  const [note, setNote] = useState("");
  const post = usePostClaimWithNote();

  // A reader with no session gets an invisible anonymous account, and the
  // composer below renders as soon as that session reaches this component.
  // The sign-in form only appears when even that fails; until then the modal
  // shows neither form, so the sign-in never flashes up during the silent
  // sign-in.
  const [anonFailed, setAnonFailed] = useState(false);
  useEffect(() => {
    if (!session) void ensureUser().then((user) => setAnonFailed(!user));
  }, [session]);

  const submit = (signed: boolean) => {
    if (!session) return;
    post.mutate(
      { item, page: pageForItem ?? { url: item!.url, title: item!.title ?? "" }, anchorText: selection, note, session, signed },
      {
        onSuccess: () => {
          onPosted?.();
          onClose();
        },
      },
    );
  };

  return (
    <Modal title="Write a note" onClose={onClose} widthClassName="max-w-[35rem]">
        <Quote>“{selection}”</Quote>
        {!session ? (
          // Signing in happens right here in the overlay. Once the session
          // lands, this branch flips to the composer and the selection is
          // still in place.
          anonFailed && <LoginPanel surface="overlay" />
        ) : (
          <Composer
            session={session}
            text={note}
            onTextChange={setNote}
            placeholder="Write your correction"
            rows={4}
            submitLabel="Post draft note"
            onSubmit={submit}
            onCancel={onClose}
            pending={post.isPending}
            error={post.error?.message ?? null}
          />
        )}
    </Modal>
  );
}
