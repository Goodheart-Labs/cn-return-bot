import { useEffect, useState } from "react";
import { ensureUser } from "@cn/core/auth";
import type { PageItem } from "@cn/core/items";
import { supabase } from "@cn/core/supabase";
import { useSession } from "@cn/features/auth/useSession";
import { Composer } from "@cn/features/notes/Composer";
import { usePostClaimWithNote } from "@cn/features/notes/useNoteWrites";
import { Modal } from "@cn/ui/Modal";
import { LoginModal } from "./LoginModal";

export interface ReaderAnchor {
  blockId: string;
  text: string;
  paragraph: string;
  partial: boolean;
}

export function ReaderWriteNote({ item, anchor, onClose, onPosted }: {
  item: PageItem;
  anchor: ReaderAnchor;
  onClose: () => void;
  onPosted: (noteId: string) => void;
}) {
  const { session } = useSession();
  const [note, setNote] = useState("");
  const [needLogin, setNeedLogin] = useState(false);
  const post = usePostClaimWithNote();

  useEffect(() => {
    if (session) {
      setNeedLogin(false);
      return;
    }
    let cancelled = false;
    void ensureUser().then((user) => {
      if (!cancelled && !user) setNeedLogin(true);
    }).catch(() => { if (!cancelled) setNeedLogin(true); });
    return () => { cancelled = true; };
  }, [session]);

  const closeLogin = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) setNeedLogin(false);
    else onClose();
  };

  if (!session && needLogin) return <LoginModal open onClose={() => void closeLogin()} />;

  return (
    <Modal title="Add a note" onClose={onClose} widthClassName="max-w-[35rem]">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {anchor.partial ? "On the words you selected" : "On this passage"}
      </p>
      <blockquote className="max-h-40 overflow-y-auto border-l-2 border-line pl-3 text-sm italic text-fg-secondary">“{anchor.text}”</blockquote>
      {session ? (
        <>
          <Composer
            session={session}
            text={note}
            onTextChange={setNote}
            placeholder="Add context, a correction, or a source for this passage."
            rows={4}
            submitLabel="Post note"
            onSubmit={(signed) => post.mutate({ item, page: { url: item.url, title: item.title ?? "" }, anchorText: anchor.text, contextParagraph: anchor.paragraph, note, session, signed }, { onSuccess: (result) => onPosted(result.noteId) })}
            onCancel={onClose}
            pending={post.isPending}
            error={post.error ? "That didn't post. Check your connection and try again." : null}
          />
          <p className="text-xs text-fg-muted">Your note appears beside the passage as “Needs more ratings” until other readers rate it.</p>
        </>
      ) : <p className="text-sm text-fg-muted" role="status">Preparing your note…</p>}
    </Modal>
  );
}
