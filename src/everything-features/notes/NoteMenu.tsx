import { useRef, useState } from "react";
import { displayName } from "@cn/core/session";
import type { NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { IconButton } from "@cn/ui/IconButton";
import { MoreIcon, PencilIcon, QuoteIcon, ShareIcon, SpeechBubbleIcon, TrashIcon } from "@cn/ui/icons";
import { Menu, MenuItem } from "@cn/ui/Menu";
import { useOutsidePress } from "@cn/ui/useOutsidePress";
import { useActingUser } from "../auth/useActingUser";
import { useSession } from "../auth/useSession";
import { Composer } from "./Composer";
import { useDeleteNote, usePostImprovement, usePostNnn } from "./useNoteWrites";

const ACTION_ICON_SIZE = 16;

/** The row of actions under a note. You can argue that the claim needs no note.
 *  You can suggest an improvement, which posts your rewrite as your own draft
 *  note on the same claim and shows it beside the original. You can copy a deep
 *  link to the note. On a note you wrote yourself there is also a ⋯ menu, and
 *  it holds Delete. */
export function NoteMenu({ note, shareUrl, sourcesOpen, onToggleSources, children }: {
  note: NoteRow;
  /** The absolute deep link to this note. The website builds it from the
   *  project slug. The extension passes the public site's URL instead. */
  shareUrl: string;
  sourcesOpen?: boolean;
  onToggleSources?: () => void;
  /** Extra actions rendered between Share and the ⋯ button. The feed uses this
   *  for the chips that jump between a note and its improvement. */
  children?: React.ReactNode;
}) {
  const { session } = useSession();
  const actingUser = useActingUser();
  const deleteNote = useDeleteNote();
  const postImprovement = usePostImprovement();
  const postNnn = usePostNnn();
  /* Only one block is expanded at a time. The ⋯ menu and the two composers
   * replace each other. The source details toggle is not part of this group and
   * opens on its own. A hidden editor unmounts, so its draft text is held here
   * in the parent and survives a switch to the other composer. */
  const [expanded, setExpanded] = useState<"menu" | "improve" | "nnn" | null>(null);
  const [improveDraft, setImproveDraft] = useState("");
  const [nnnDraft, setNnnDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mine = !!session && session.user.id === note.author_id;

  // A press anywhere outside the action row, which includes the rest of the
  // note, closes the ⋯ menu. The composers are not closed this way. Only an
  // explicit action closes those.
  useOutsidePress(ref, expanded === "menu", () => setExpanded(null));

  const share = async () => {
    setExpanded((prev) => (prev === "menu" ? null : prev));
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  /** After a post, the draft is cleared and the composer closes. */
  const closeComposer = (clearDraft: (text: string) => void) => () => {
    clearDraft("");
    setExpanded(null);
  };
  const del = () => {
    setExpanded(null);
    deleteNote.mutate(note.id);
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
      <div ref={ref} className="relative flex flex-wrap justify-end items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        {/* The sources, improve and share actions are visible on every card.
            The ⋯ menu only holds Delete, and only on your own notes. Nathan
            moved the other actions out of it on 2026-07-14, because the menu
            was hiding the whole improvement flow. */}
        {showSourcesButton && (
          <Button variant="link" onClick={onToggleSources}>
            <QuoteIcon size={ACTION_ICON_SIZE} aria-hidden /> {sourcesOpen ? "Hide source details" : "Show source details"}
          </Button>
        )}
        <Button variant="link" onClick={() => toggleComposer("nnn")}>
          <SpeechBubbleIcon size={ACTION_ICON_SIZE} aria-hidden /> Note not needed
        </Button>
        {/* Improving your own note makes no sense as a second card beside it.
            An author who wants different wording deletes and rewrites. */}
        {!mine && (
          <Button variant="link" onClick={() => toggleComposer("improve")}>
            <PencilIcon size={ACTION_ICON_SIZE} aria-hidden /> Suggest an improvement
          </Button>
        )}
        <Button variant="link" onClick={share} className={copied ? "text-positive" : undefined}>
          {copied ? "Link copied" : <><ShareIcon size={ACTION_ICON_SIZE} aria-hidden /> Share</>}
        </Button>
        {children}
        {mine && (
          <IconButton label="Note actions" onClick={() => setExpanded((prev) => (prev === "menu" ? null : "menu"))}>
            <MoreIcon size={ACTION_ICON_SIZE} aria-hidden />
          </IconButton>
        )}
        {expanded === "menu" && mine && (
          /* The menu sits in the normal flow and wraps onto its own line. It is
           * deliberately not positioned absolutely. In the extension the card
           * lives inside a scrolling popover with a maximum height, and a
           * dropdown hanging below the action row spilled past that edge. The
           * reader then saw a scrollbar instead of the menu. Sitting in the
           * flow grows the card instead, the same way the two composers do. */
          <div className="w-full flex justify-end mt-1">
            <Menu>
              <MenuItem onClick={del} icon={<TrashIcon size={ACTION_ICON_SIZE} />} danger autoFocus>Delete</MenuItem>
            </Menu>
          </div>
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
          onSubmit={(signed) => postImprovement.mutate({ note, text: improveDraft, session, signed }, { onSuccess: closeComposer(setImproveDraft) })}
          onCancel={() => setExpanded(null)}
          pending={postImprovement.isPending}
          error={postImprovement.error?.message ?? null}
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
              { onSuccess: closeComposer(setNnnDraft) },
            )
          }
          onCancel={() => setExpanded(null)}
          pending={postNnn.isPending}
          error={postNnn.error?.message ?? null}
        />
      )}
    </div>
  );
}
