import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { NoteRow } from "../lib/types";
import { CHARITIES, saveDonation, setVoteReasoning, usePreferredCharity, type CharityId } from "../lib/donations";
import { postComment } from "../lib/comments";
import { isEarnestNote } from "../lib/judgeNote";
import { displayName } from "../lib/session";
import { AutoGrowTextarea, PostAsCheckbox, RejectedNotice, useSignedByline } from "./editorBits";

const charityLabel = (id: CharityId) => CHARITIES.find((c) => c.id === id)!.label;

/** The charity name inline in the donation copy — clickable, opening a small
 *  popover to redirect the $2 to one of the other charities. */
function CharityPicker({ charity, onPick }: { charity: CharityId; onPick: (c: CharityId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-blue-600 font-medium hover:underline"
        title="Choose a different charity"
      >
        {charityLabel(charity)}
      </button>
      {open && (
        <div className="cn-menu absolute left-0 top-6 z-20 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 text-sm">
          {CHARITIES.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onPick(c.id);
                setOpen(false);
              }}
              aria-pressed={c.id === charity}
              className={`flex w-full items-center text-left px-2.5 py-2 rounded-lg font-medium hover:bg-gray-100 ${
                c.id === charity ? "text-blue-600" : "text-gray-700"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Shown right after casting a note vote: explain the vote and we donate $2 to
 *  a charity of the voter's choice. The reasoning stays private on the vote
 *  row unless "post as a comment" makes it a public top-level comment — either
 *  way it's the same single $2, keyed to the vote. */
export function VoteReasoning({ note, voteId, session, onCommentAuthored, onClose }: {
  note: NoteRow;
  voteId: string;
  session: Session;
  onCommentAuthored: (commentId: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [charity, setCharity] = usePreferredCharity();
  const [asComment, setAsComment] = useState(false);
  const [signed, setSigned] = useSignedByline();
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRejected(false);
    try {
      const earnest = await isEarnestNote(text.trim(), note.claim?.context_quote ?? "", note.note);
      if (!earnest) return setRejected(true);
      if (asComment) {
        const commentId = await postComment({
          noteId: note.id,
          voteId,
          body: text.trim(),
          authorId: session.user.id,
          authorName: signed ? displayName(session) : null,
        });
        if (!commentId) return setError("Could not post the comment — try again.");
        onCommentAuthored(commentId);
      } else {
        const { error } = await setVoteReasoning(voteId, text.trim());
        if (error) return setError(error.message);
      }
      const { error: donationError } = await saveDonation(voteId, charity);
      if (donationError) return setError(donationError.message);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mt-2 text-sm rounded-lg p-2 bg-green-50 text-green-800 border border-green-200 flex items-center justify-between gap-2">
        <span>Thank you! We'll donate $2 to {charityLabel(charity)}.</span>
        <button onClick={onClose} className="text-xs text-green-700 hover:underline shrink-0">Close</button>
      </div>
    );
  }

  return (
    // Theme note: only unmodified utility classes (bg-blue-50, not bg-blue-50/50)
    // — design.css remaps the exact class names per color scheme.
    <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
      <p className="text-sm text-gray-700">
        If you explain your reasoning, we'll donate <strong>$2</strong> to{" "}
        <CharityPicker charity={charity} onPick={setCharity} />
      </p>
      <AutoGrowTextarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setRejected(false);
        }}
        rows={2}
        placeholder="Why did you vote this way?"
        className="bg-white"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={asComment} onChange={(e) => setAsComment(e.target.checked)} />
          Post this as a comment
        </label>
        {asComment && <PostAsCheckbox signed={signed} onChange={setSigned} session={session} />}
      </div>
      <div className="flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Checking…" : asComment ? "Post comment" : "Submit"}
        </button>
        <button onClick={onClose} className="text-sm text-gray-500 hover:underline">No thanks</button>
      </div>
      {rejected && <RejectedNotice>That didn't look like genuine reasoning — try again.</RejectedNotice>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
