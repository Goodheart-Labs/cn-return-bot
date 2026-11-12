import { useState } from "react";
import { displayName } from "@cn/core/session";
import type { NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { ConfirmDelete } from "@cn/ui/ConfirmDelete";
import { PencilIcon, QuoteIcon, ShareIcon, SpeechBubbleIcon } from "@cn/ui/icons";
import { useActingUser } from "../auth/useActingUser";
import { useSession } from "../auth/useSession";
import { Composer } from "./Composer";
import { useDeleteNote, usePostImprovement, usePostNnn } from "./useNoteWrites";

/** The action icons are sized relative to the row's text, so they stay in
 *  proportion on the website's larger text and on the extension's smaller one.
 *  Filled icons at a fixed 16px looked heavy next to the extension's 12px text. */
const ACTION_ICON_SIZE = "1.15em";

/** On a touch screen the action links grow to a finger-sized target. */
const TOUCH_TARGET = "[@media(pointer:coarse)]:min-h-10";

/** What a reader sees when posting fails. The database's own message means
 *  nothing to them, so it goes to the console instead. */
const POST_FAILED = "That didn't post. Check your connection and try again.";
const logPostFailure = (what: string) => (err: Error) => console.error(`[common-notes] posting ${what} failed:`, err);

/** The row of actions under a note. You can argue that the claim needs no note.
 *  You can suggest an improvement, which posts your rewrite as your own draft
 *  note on the same claim and shows it beside the original. You can copy a deep
 *  link to the note. On a note you wrote yourself there is also a trash button,
 *  which asks once before it deletes. */
export function NoteMenu({ note, shareUrl, sourcesOpen, onToggleSources, children }: {
  note: NoteRow;
  /** The absolute deep link to this note. The website builds it from the
   *  project slug. The extension passes the public site's URL instead. */
  shareUrl: string;
  sourcesOpen?: boolean;
  onToggleSources?: () => void;
  /** Extra actions rendered between Share and the trash button. The feed uses this
   *  for the chips that jump between a note and its improvement. */
  children?: React.ReactNode;
}) {
  const { session } = useSession();
  const actingUser = useActingUser();
  const deleteNote = useDeleteNote();
  const postImprovement = usePostImprovement();
  const postNnn = usePostNnn();
  /* Only one composer is open at a time. The source details toggle is not part
   * of this group and opens on its own. A hidden editor unmounts, so its draft
   * text is held here in the parent and survives a switch to the other
   * composer. */
  const [expanded, setExpanded] = useState<"improve" | "nnn" | null>(null);
  const [improveDraft, setImproveDraft] = useState("");
  const [nnnDraft, setNnnDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const mine = !!session && session.user.id === note.author_id;

  const share = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  /** After a post, the draft is cleared and the composer closes. */
  const closeComposer = (clearDraft: (text: string) => void) => () => {
    clearDraft("");
    setExpanded(null);
  };
  // A reader with no session gets an invisible anonymous account on the spot,
  // and the composer renders as soon as the new session reaches this
  // component. Only when even that fails does the sign-in form appear.
  const toggleComposer = async (composer: "improve" | "nnn") => {
    if (!(await actingUser())) return;
    setExpanded((prev) => (prev === composer ? null : composer));
  };
  // Every card already shows its source links. This toggle only reveals the
  // quote and explanation for each source, so it appears only if a quote exists.
  const showSourcesButton = !!onToggleSources && note.has_source_details;

  return (
    <div className="mt-2">
      <div className="relative flex flex-wrap justify-end items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        {/* The sources, improve and share actions are visible on every card.
            Your own notes also get the trash button. Until 2026-11-12 it
            was a ⋯ menu holding only Delete. Nathan had moved the other
            actions out of that menu on 2026-07-14, because it was hiding the
            whole improvement flow. */}
        {showSourcesButton && (
          // The label stays the same when the details open. A label that changed
          // width made the row wrap differently in the two states.
          <Button variant="link" className={TOUCH_TARGET} aria-expanded={!!sourcesOpen} onClick={onToggleSources}>
            <QuoteIcon size={ACTION_ICON_SIZE} aria-hidden /> Source details
          </Button>
        )}
        <Button variant="link" className={TOUCH_TARGET} onClick={() => toggleComposer("nnn")}>
          <SpeechBubbleIcon size={ACTION_ICON_SIZE} aria-hidden /> Note not needed
        </Button>
        {/* Improving your own note makes no sense as a second card beside it.
            An author who wants different wording deletes and rewrites. */}
        {!mine && (
          <Button variant="link" className={TOUCH_TARGET} onClick={() => toggleComposer("improve")}>
            <PencilIcon size={ACTION_ICON_SIZE} aria-hidden /> Suggest an improvement
          </Button>
        )}
        <Button variant="link" onClick={share} className={cn(TOUCH_TARGET, copied && "text-positive")}>
          {copied ? "Link copied" : <><ShareIcon size={ACTION_ICON_SIZE} aria-hidden /> Share</>}
        </Button>
        {children}
        {mine && (
          <ConfirmDelete
            label="Delete note"
            iconSize={ACTION_ICON_SIZE}
            onDelete={() => void deleteNote.mutateAsync(note.id).catch(() => {})}
          />
        )}
      </div>
      {expanded === "improve" && session && (
        <Composer
          session={session}
          text={improveDraft}
          onTextChange={setImproveDraft}
          placeholder="Write a clearer or better-sourced version"
          rows={3}
          submitLabel="Post note"
          onSubmit={(signed) =>
            postImprovement.mutate({ note, text: improveDraft, session, signed }, { onSuccess: closeComposer(setImproveDraft), onError: logPostFailure("an improvement") })
          }
          onCancel={() => setExpanded(null)}
          pending={postImprovement.isPending}
          error={postImprovement.error ? POST_FAILED : null}
        />
      )}
      {expanded === "nnn" && session && (
        <Composer
          session={session}
          text={nnnDraft}
          onTextChange={setNnnDraft}
          placeholder="Why does this claim need no note?"
          rows={2}
          submitLabel="Post"
          onSubmit={(signed) =>
            postNnn.mutate(
              { claimId: note.claim_id, body: nnnDraft.trim(), authorId: session.user.id, authorName: signed ? displayName(session) : null },
              { onSuccess: closeComposer(setNnnDraft), onError: logPostFailure("a note-not-needed entry") },
            )
          }
          onCancel={() => setExpanded(null)}
          pending={postNnn.isPending}
          error={postNnn.error ? POST_FAILED : null}
        />
      )}
    </div>
  );
}
