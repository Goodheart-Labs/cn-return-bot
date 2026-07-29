import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import type { NnnApi } from "../../everything-web/src/components/NoteNotNeeded";
import type { Vote } from "../../everything-shared/votes";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import type { PageItem } from "../../everything-shared/notesQuery";
import { insideCommonNotesUi, isInertClick } from "../utils/inertClick";
import { ABSORB_KEYS, ClaimNoteStack, GroupIcon, NOTE_POPOVER_WIDTH, SignInHint } from "./ClaimNoteStack";
import { NoteWithActions } from "./NoteWithActions";
import { useNoteVoting, replaceNoteInGroup } from "./useNoteVoting";
import { WriteNoteOverlay } from "./WriteNoteOverlay";

/** One anchored claim: its notes (originals first), its note-not-needed
 *  entries, and where it sits on the page. */
export interface AnchoredGroup {
  claimId: string;
  primary: NoteRow;
  alternatives: NoteRow[];
  nnn: NnnRow[];
  range: Range;
}

const BADGE_SIZE = 20;
const BADGE_GAP = 4; // px between the passage's end and the badge
const POPOVER_GAP = 8; // px between the passage and the opened popover
const VIEWPORT_MARGIN = 8; // keep the popover this far from the viewport edges

/** Range rect relative to the in-content annotation layer — both rects read
 *  in the same layout pass, so the pair is scroll-invariant: the layer sits
 *  inside the article and moves with the text under any scroll container. */
function relRect(range: Range, origin: DOMRect) {
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
    left: rect.left - origin.left,
  };
}


/** Small badge at the end of the anchored passage: blue community glyph on a
 *  light/dark surface following the host page's theme. */
function Badge({ open, onClick, style }: { open: boolean; onClick: () => void; style: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      title="Community note on this passage"
      aria-expanded={open}
      style={style}
      className={`absolute flex items-center justify-center rounded-full border shadow transition-transform hover:scale-110 bg-white border-gray-300 text-blue-600 dark:bg-gray-900 dark:border-gray-600 dark:text-blue-500 ${open ? "ring-2 ring-blue-500" : ""}`}
    >
      <GroupIcon />
    </button>
  );
}

function NotePopover({ group, projectSlug, session, myVotes, onVote, onNeedLogin, onAuthored, onNnnAuthored, onDeleted, nnnApi, style }: {
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
}) {
  return (
    // max-h + inner scroll: a claim can stack several notes plus an open
    // composer — taller than the viewport. overscroll-contain keeps the inner
    // scroll from chaining into the host page.
    <div style={style} className="absolute bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl p-3 text-left max-h-[70vh] overflow-y-auto overscroll-contain">
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

/** All badges + popovers for one page. They render (via portal) into the
 *  in-content annotation layer and are absolutely positioned relative to it,
 *  so scrolling moves them natively with the text — no per-frame JS. The
 *  viewport-fixed pieces (sign-in hint, write modal) stay in the body-level
 *  host, where position:fixed is safe from article-ancestor transforms. */
export function InlineNotesApp({ groups: initialGroups, item, onPosted, container, inlineContainer }: {
  groups: AnchoredGroup[];
  item: PageItem;
  onPosted: () => void;
  /** The article container the ranges live in (re-queried per render). */
  container: Element;
  /** The annotation layer's React-root element inside `container`. */
  inlineContainer: HTMLElement;
}) {
  const projectSlug = item.projectSlug;
  const [groups, setGroups] = useState(initialGroups);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [writeSelection, setWriteSelection] = useState<string | null>(null);
  const { session, myVotes, myNnnVotes, handleVote, handleNnnVote, recordAuthored, recordNnnAuthored, onNeedLogin, signInHint, dismissSignInHint } = useNoteVoting(
    (updated) => setGroups((prev) => prev.map((g) => replaceNoteInGroup(g, updated))),
    (updatedEntry) => setGroups((prev) => prev.map((g) => ({
      ...g,
      nnn: g.nnn.map((e) => (e.id === updatedEntry.id ? updatedEntry : e)),
    }))),
  );
  // A just-posted improvement / entry: light up its self-vote and refetch the
  // item's notes so it appears in its claim group.
  const handleAuthored = (noteId: string) => {
    recordAuthored(noteId);
    onPosted();
  };
  const handleNnnAuthored = (entryId: string) => {
    recordNnnAuthored(entryId);
    onPosted();
  };
  // No realtime in the extension: deletes refresh the item's groups explicitly.
  const nnnApi: NnnApi = { myVotes: myNnnVotes, onVote: handleNnnVote, onAuthored: recordNnnAuthored, onDeleted: () => onPosted() };
  // Bumped on resize so positions derived from ranges recompute.
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => setGroups(initialGroups), [initialGroups]);

  useEffect(() => {
    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLayoutTick((t) => t + 1));
    };
    window.addEventListener("resize", relayout);
    // Fallback only: the annotation layer lives inside the article, so
    // shared-scroller scrolls recompute to identical values (React diffs to
    // zero DOM writes — no visible movement). This catches the rare range
    // inside a NESTED scroller (scrollable code block / table) the layer
    // doesn't share.
    document.addEventListener("scroll", relayout, { capture: true, passive: true });
    // Passages reflow as the host page's images/embeds finish loading — an
    // <img> gaining height fires no DOM mutation, so cached positions would
    // drift from their passage. body catches document-height changes; the
    // article container must be observed too, because in inner-scroll layouts
    // (the reader) body stays viewport-locked while the article grows.
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

  // The tint itself is a CSS highlight — not an element, so it can't receive
  // events. Hit-test host-page clicks against each claim's range instead, so
  // clicking a tinted passage toggles its note like clicking the badge does.
  // The close-on-outside-press listener lives here too and skips tinted
  // passages: closing on mousedown and reopening on the click's hit-test
  // made a highlight click flash the popover shut and instantly reopen it.
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
      // Clicks inside our own overlay bubble out of the shadow root too — the
      // popover overlaps page text, so without this guard a vote click would
      // also hit-test the passage underneath and open ITS note.
      if (insideCommonNotesUi(e) || claimAt(e.clientX, e.clientY)) return;
      // Only empty-surface presses close the note: a click that does
      // something (a link, a like button) shouldn't also dismiss it.
      if (!isInertClick(e)) return;
      setOpenClaim(null);
    };
    const onClick = (e: MouseEvent) => {
      if (insideCommonNotesUi(e)) return;
      // A drag-selection (e.g. selecting text to write a note on) ends in a
      // click too — don't hijack it.
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

  // Requests from the popup (jump through the notes in document order,
  // wrapping) and the background's context menu (write a note on the current
  // selection). The cursor lives here so "next" survives popup reopenings;
  // it resets with the page.
  const jumpCursor = useRef(-1);
  useEffect(() => {
    const ordered = [...groups].sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
    const listener = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      const { type, selection } = (message as { type?: string; selection?: string }) ?? {};
      if (type === "cn-jump-state") sendResponse({ jumped: jumpCursor.current >= 0 });
      if (type === "cn-jump-note" && ordered.length) {
        jumpCursor.current = (jumpCursor.current + 1) % ordered.length;
        const target = ordered[jumpCursor.current];
        target.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        setOpenClaim(target.claimId);
        sendResponse({ jumped: true });
      }
      if (type === "cn-write-note" && selection?.trim()) setWriteSelection(selection.trim());
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    return () => runtime?.onMessage.removeListener(listener);
  }, [groups]);

  const positioned = useMemo(() => {
    // Read the layer origin and every range rect in the same layout pass —
    // never cache the origin across renders, or the pair loses its
    // scroll-invariance.
    const origin = inlineContainer.getBoundingClientRect();
    return groups.map((group) => {
      const rect = relRect(group.range, origin);
      // Clamp the popover into the VIEWPORT, expressed in layer space:
      // client x = layer x + origin.left, so viewport edge M maps to
      // M - origin.left (same clamp as before, minus the scroll offsets).
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
    // Absorb mouse AND keyboard: mousedown would close the popover via the
    // document listener above; click would leak to the host page and to our
    // own passage hit-test; keys typed in a composer would trigger host-page
    // hotkeys (see ABSORB_KEYS).
    <div {...ABSORB_KEYS} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {signInHint && <SignInHint onDismiss={dismissSignInHint} className="fixed top-4 right-4 z-50" />}
      {writeSelection && (
        <WriteNoteOverlay
          item={item}
          selection={writeSelection}
          session={session}
          onClose={() => setWriteSelection(null)}
          onPosted={onPosted}
        />
      )}
      {/* Badges/popovers portal into the in-content annotation layer so they
          scroll natively with the text; the wrapper re-absorbs events there
          (React attaches listeners to portal containers, so stopPropagation
          halts the native event before the document-level listeners). */}
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
