import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { NoteRow } from "../lib/types";
import { CHARITIES, setDonationCharity, usePreferredCharity, type CharityId } from "../lib/donations";
import type { DonationPair } from "../lib/donationScoring";
import { postComment } from "../lib/comments";
import { displayName } from "../lib/session";
import { AutoGrowTextarea, PostAsCheckbox, useSignedByline } from "./editorBits";

const charityLabel = (id: CharityId) => CHARITIES.find((c) => c.id === id)!.label;

/** The charity name inline in the donation copy — clickable, opening a small
 *  popover to redirect the donation to one of the other charities. */
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

/** Shown right after casting a note vote: the donation this vote minted — an
 *  outcome-contingent pair frozen at vote time — with the charity switchable
 *  inline, plus a button to write a public comment on the note (a top-level
 *  comment tied to the vote, ungated). Private vote reasoning was dropped in
 *  favor of just commenting (Jim, 2026-07-17). */
export function VoteDonation({ note, voteId, pair, session, onCommentAuthored, onClose }: {
  note: NoteRow;
  voteId: string;
  pair: DonationPair;
  session: Session;
  onCommentAuthored: (commentId: string) => void;
  onClose: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [charity, setCharityPref] = usePreferredCharity();
  const [signed, setSigned] = useSignedByline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The donation row already exists (minted with the vote); a pick updates it
  // and becomes the remembered default for future votes.
  const pickCharity = (c: CharityId) => {
    setCharityPref(c);
    void setDonationCharity(voteId, c);
  };

  const submitComment = async () => {
    setBusy(true);
    setError(null);
    try {
      const commentId = await postComment({
        noteId: note.id,
        voteId,
        body: text.trim(),
        authorId: session.user.id,
        authorName: signed ? displayName(session) : null,
      });
      if (!commentId) return setError("Could not post the comment — try again.");
      onCommentAuthored(commentId);
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
        <span>Thank you! Your comment is posted.</span>
        <button onClick={onClose} className="text-xs text-green-700 hover:underline shrink-0">Close</button>
      </div>
    );
  }

  return (
    // Theme note: only unmodified utility classes (bg-blue-50, not bg-blue-50/50)
    // — design.css remaps the exact class names per color scheme.
    <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
      <p className="text-sm text-gray-700">
        We will donate <strong>${pair.ifHelpful.toFixed(2)}</strong> to{" "}
        <CharityPicker charity={charity} onPick={pickCharity} /> if this note ends up rated{" "}
        <span className="font-medium text-green-700">helpful</span> and{" "}
        <strong>${pair.ifNotHelpful.toFixed(2)}</strong> if it ends up rated{" "}
        <span className="font-medium text-red-600">unhelpful</span>.
      </p>
      {composing && (
        <AutoGrowTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          autoFocus
          placeholder="Write a comment about this note…"
          className="bg-white"
        />
      )}
      <div className="flex gap-2 items-center">
        {composing ? (
          <>
            <button
              onClick={submitComment}
              disabled={busy || text.trim().length < 10}
              className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? "Posting…" : "Post comment"}
            </button>
            <button onClick={() => setComposing(false)} className="text-sm text-gray-500 hover:underline">Cancel</button>
            <PostAsCheckbox signed={signed} onChange={setSigned} session={session} className="ml-auto" />
          </>
        ) : (
          <>
            <button
              onClick={() => setComposing(true)}
              className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm font-medium hover:bg-blue-700"
            >
              Write a comment
            </button>
            <button onClick={onClose} className="text-sm text-gray-500 hover:underline">Close</button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
