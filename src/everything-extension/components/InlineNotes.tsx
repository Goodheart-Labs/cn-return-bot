import { useEffect, useMemo, useRef, useState } from "react";
import { FLOATING_CARD } from "../../everything-shared/ui";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import type { NnnApi } from "../../everything-web/src/components/NoteNotNeeded";
import type { Vote } from "../../everything-shared/votes";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import type { PageItem } from "../../everything-shared/notesQuery";
import { insideCommonNotesUi, isInertClick } from "../utils/inertClick";
import { setJumpHandler } from "../utils/jumpBus";
import { ABSORB_KEYS, ClaimNoteStack, GroupIcon, NOTE_POPOVER_WIDTH, OverlayLogin } from "./ClaimNoteStack";
import { NoteWithActions } from "./NoteWithActions";
import { useNoteVoting, replaceNoteInGroup } from "./useNoteVoting";
import { WriteNoteOverlay } from "./WriteNoteOverlay";

/** One claim anchored to the page. It carries the claim's notes with the
 *  original first, its note-not-needed entries, and the stretch of page text it
 *  sits on. */
export interface AnchoredGroup {
  claimId: string;
  primary: NoteRow;
  alternatives: NoteRow[];
  nnn: NnnRow[];
  range: Range;
}

const BADGE_SIZE = 20;
const BADGE_GAP = 4; // Pixels between the end of the passage and the badge.
const POPOVER_GAP = 8; // Pixels between the passage and the opened popover.
const VIEWPORT_MARGIN = 8; // The popover stays this many pixels from the edges.

/** Gives the range's rectangle relative to the in-content annotation layer. Both
 *  rectangles are read in the same layout pass, so the pair does not change when
 *  the page scrolls. The layer sits inside the article and moves with the text
 *  under any scroll container. */
function relRect(range: Range, origin: DOMRect) {
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
    left: rect.left - origin.left,
  };
}


/** The small badge at the end of an anchored passage. It draws the blue
 *  community glyph on a surface that follows the host page's light or dark
 *  theme. */
function Badge({ open, onClick, style }: { open: boolean; onClick: () => void; style: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      title="Community note on this passage"
      aria-expanded={open}
      style={style}
      className={`absolute flex items-center justify-center rounded-full border shadow transition-transform hover:scale-110 bg-white border-gray-300 text-blue-600 dark:bg-gray-900 dark:border-gray-600 dark:text-blue-400 ${open ? "ring-2 ring-blue-500" : ""}`}
    >
      <GroupIcon />
    </button>
  );
}

function NotePopover({ group, projectSlug, session, myVotes, onVote, onNeedLogin, onAuthored, onNnnAuthored, onDeleted, nnnApi, style, loginOpen, onCloseLogin }: {
  group: AnchoredGroup;
  projectSlug: string | null;
  session: Session | null;
  myVotes: Map<string, Vote>;
  onVote: NoteWithActionsVote;
  onNeedLogin: () => void;
  onAuthored: (noteId: string) => void;
  onNnnAuthored: (entryId: string) => void;
  onDeleted: () => void;
  nnnApi: NnnApi;
  style: React.CSSProperties;
  loginOpen: boolean;
  onCloseLogin: () => void;
}) {
  return (
    // The popover has a maximum height and scrolls inside itself. One claim can
    // stack several notes and an open composer, which gets taller than the
    // viewport. The overscroll-contain class stops that inner scroll from
    // carrying on into the host page.
    <div style={style} className={`absolute ${FLOATING_CARD} p-4 text-left max-h-[70vh] overflow-y-auto overscroll-contain`}>
      {loginOpen && !session && <OverlayLogin onDismiss={onCloseLogin} />}
      <ClaimNoteStack
        group={group}
        projectSlug={projectSlug}
        session={session}
        myVotes={myVotes}
        onVote={onVote}
        onNeedLogin={onNeedLogin}
        onAuthored={onAuthored}
        onNnnAuthored={onNnnAuthored}
        onDeleted={onDeleted}
        nnnApi={nnnApi}
      />
    </div>
  );
}

type NoteWithActionsVote = React.ComponentProps<typeof NoteWithActions>["onVote"];

/** Every badge and popover for one page. They are rendered through a portal into
 *  the in-content annotation layer and positioned absolutely inside it, so
 *  scrolling moves them along with the text and no JavaScript runs per frame.
 *  The two pieces that are fixed to the viewport, the sign-in hint and the write
 *  modal, stay in the host element at body level. There a transform on an
 *  ancestor of the article cannot break position:fixed. */
export function InlineNotesApp({ groups: initialGroups, item, onPosted, container, inlineContainer }: {
  groups: AnchoredGroup[];
  item: PageItem;
  onPosted: () => void;
  /** The article container the ranges live in. It is looked up again on every
   *  render. */
  container: Element;
  /** The React root element of the annotation layer, which sits inside
   *  `container`. */
  inlineContainer: HTMLElement;
}) {
  const projectSlug = item.projectSlug;
  const [groups, setGroups] = useState(initialGroups);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [writeSelection, setWriteSelection] = useState<string | null>(null);
  const { session, myVotes, myNnnVotes, handleVote, handleNnnVote, recordAuthored, recordNnnAuthored, onNeedLogin, loginOpen, closeLogin } = useNoteVoting(
    (updated) => setGroups((prev) => prev.map((g) => replaceNoteInGroup(g, updated))),
    (updatedEntry) => setGroups((prev) => prev.map((g) => ({
      ...g,
      nnn: g.nnn.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)),
    }))),
  );
  // An improvement or a note-not-needed entry has just been posted. We light up
  // the author's own vote on it and refetch the item's notes, so the new one
  // shows up in its claim group.
  const handleAuthored = (noteId: string) => {
    recordAuthored(noteId);
    onPosted();
  };
  const handleNnnAuthored = (entryId: string) => {
    recordNnnAuthored(entryId);
    onPosted();
  };
  // The extension gets no realtime updates, so a delete refreshes the item's
  // groups by hand.
  const nnnApi: NnnApi = { myVotes: myNnnVotes, onVote: handleNnnVote, onAuthored: recordNnnAuthored, onDeleted: () => onPosted() };
  // This counter is bumped on a resize, so the positions derived from the ranges
  // are computed again.
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => setGroups(initialGroups), [initialGroups]);

  useEffect(() => {
    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLayoutTick((t) => t + 1));
    };
    window.addEventListener("resize", relayout);
    // This scroll listener is only a fallback. The annotation layer lives inside
    // the article, so a scroll of a shared scroller recomputes to exactly the
    // same positions and React writes nothing to the DOM. The listener exists
    // for the rare range that sits in a nested scroller the layer does not
    // share, such as a scrollable code block or table.
    document.addEventListener("scroll", relayout, { capture: true, passive: true });
    // Passages move as the host page's images and embeds finish loading. An
    // <img> that gains height fires no DOM mutation, so the cached positions
    // would drift away from their passage. Observing the body catches changes in
    // the document's height. The article container has to be observed as well.
    // In an inner-scroll layout such as Substack's reader, the body stays locked
    // to the viewport while the article itself grows.
    const resizeObserver = new ResizeObserver(relayout);
    resizeObserver.observe(document.body);
    resizeObserver.observe(container);
    return () => {
      window.removeEventListener("resize", relayout);
      document.removeEventListener("scroll", relayout, { capture: true } as EventListenerOptions);
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [container]);

  // The passage tint is a CSS highlight rather than an element, so it cannot
  // receive events. We test every host-page click against each claim's range
  // instead. Clicking a tinted passage then toggles its note, just as clicking
  // the badge does. The listener that closes the popover on an outside press
  // lives here too, and it skips tinted passages. Closing on mousedown and
  // reopening from the click's hit test made a click on a highlight flash the
  // popover shut and open it again straight away.
  useEffect(() => {
    const claimAt = (x: number, y: number): string | null => {
      for (const group of groups) {
        for (const rect of group.range.getClientRects()) {
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return group.claimId;
        }
      }
      return null;
    };
    const onDown = (e: MouseEvent) => {
      // Clicks inside our own overlay bubble out of the shadow root as well. The
      // popover overlaps the page text, so without this guard a click on a vote
      // pill would also hit-test the passage underneath and open that passage's
      // note.
      if (insideCommonNotesUi(e) || claimAt(e.clientX, e.clientY)) return;
      // Only a press on empty surface closes the note. A click that does
      // something, such as one on a link or a like button, should not dismiss
      // the note as well.
      if (!isInertClick(e)) return;
      setOpenClaim(null);
    };
    const onClick = (e: MouseEvent) => {
      if (insideCommonNotesUi(e)) return;
      // Dragging out a selection, for example to write a note on some text, ends
      // in a click as well. We leave that click alone.
      if (!window.getSelection()?.isCollapsed) return;
      const claimId = claimAt(e.clientX, e.clientY);
      if (claimId) setOpenClaim((previous) => (previous === claimId ? null : claimId));
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("click", onClick);
    };
  }, [groups]);

  // Handles the two requests that arrive from elsewhere in the extension. The
  // popup asks to jump through the notes in document order, wrapping around at
  // the end. The background's context menu asks to write a note on the current
  // selection. The jump cursor lives here so that "next" keeps its place when
  // the popup is closed and opened again. It resets when the page does.
  const jumpCursor = useRef(-1);
  useEffect(() => {
    const ordered = [...groups].sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
    const jumpNext = () => {
      if (!ordered.length) return;
      jumpCursor.current = (jumpCursor.current + 1) % ordered.length;
      const target = ordered[jumpCursor.current]!;
      target.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
      setOpenClaim(target.claimId);
    };
    const listener = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      const { type, selection } = (message as { type?: string; selection?: string }) ?? {};
      if (type === "cn-jump-state") sendResponse({ jumped: jumpCursor.current >= 0 });
      if (type === "cn-jump-note" && ordered.length) {
        jumpNext();
        sendResponse({ jumped: true });
      }
      if (type === "cn-write-note" && selection?.trim()) setWriteSelection(selection.trim());
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    // The note-count card jumps through the same cursor, see utils/jumpBus.ts.
    setJumpHandler(jumpNext);
    return () => {
      runtime?.onMessage.removeListener(listener);
      setJumpHandler(null);
    };
  }, [groups]);

  const positioned = useMemo(() => {
    // Read the layer's origin and every range rectangle in the same layout pass.
    // Never cache the origin across renders. The two would then come from
    // different scroll positions, and the result would no longer hold as the
    // page scrolls.
    const origin = inlineContainer.getBoundingClientRect();
    return groups.map((group) => {
      const rect = relRect(group.range, origin);
      // Keep the popover inside the viewport, with the numbers expressed in the
      // layer's own coordinates. A client x equals the layer x plus origin.left,
      // so a viewport edge at M becomes M - origin.left here.
      const popLeft = Math.max(
        VIEWPORT_MARGIN - origin.left,
        Math.min(rect.left, window.innerWidth - NOTE_POPOVER_WIDTH - VIEWPORT_MARGIN - origin.left),
      );
      return {
        group,
        badgeStyle: {
          top: rect.top - BADGE_SIZE / 2,
          left: rect.right + BADGE_GAP,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
        } satisfies React.CSSProperties,
        popoverStyle: {
          top: rect.bottom + POPOVER_GAP,
          left: popLeft,
          width: Math.min(NOTE_POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
          zIndex: 2,
        } satisfies React.CSSProperties,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, layoutTick, inlineContainer]);

  return (
    // Absorb both mouse and keyboard events here. A mousedown would otherwise
    // close the popover through the document listener above. A click would leak
    // to the host page and to our own passage hit test. Keys typed in a composer
    // would trigger the host page's own hotkeys. See ABSORB_KEYS.
    <div {...ABSORB_KEYS} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {writeSelection && (
        <WriteNoteOverlay
          item={item}
          selection={writeSelection}
          session={session}
          onClose={() => setWriteSelection(null)}
          onPosted={onPosted}
        />
      )}
      {/* The badges and popovers are portalled into the in-content annotation
          layer, so they scroll with the text. The wrapper absorbs events again
          on that side. React attaches its listeners to the portal container, so
          stopPropagation halts the native event before it reaches the
          document-level listeners. */}
      {createPortal(
        <div {...ABSORB_KEYS} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {positioned.map(({ group, badgeStyle, popoverStyle }) => (
            <div key={group.claimId}>
              <Badge
                open={openClaim === group.claimId}
                onClick={() => setOpenClaim((cur) => (cur === group.claimId ? null : group.claimId))}
                style={badgeStyle}
              />
              {openClaim === group.claimId && (
                <NotePopover
                  group={group}
                  projectSlug={projectSlug}
                  session={session}
                  myVotes={myVotes}
                  onVote={handleVote}
                  onNeedLogin={onNeedLogin}
                  onAuthored={handleAuthored}
                  onNnnAuthored={handleNnnAuthored}
                  onDeleted={onPosted}
                  nnnApi={nnnApi}
                  style={popoverStyle}
                  loginOpen={loginOpen}
                  onCloseLogin={closeLogin}
                />
              )}
            </div>
          ))}
        </div>,
        inlineContainer,
      )}
    </div>
  );
}
