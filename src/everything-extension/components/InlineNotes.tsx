import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { NoteNotNeeded, type NnnApi } from "../../everything-web/src/components/NoteNotNeeded";
import type { Vote } from "../../everything-shared/votes";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import type { PageItem } from "../../everything-shared/notesQuery";
import { noteShareUrl } from "../utils/share";
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
const POPOVER_WIDTH = 560;
const POPOVER_GAP = 8; // px between the passage and the opened popover
const VIEWPORT_MARGIN = 8; // keep the popover this far from the viewport edges

function pageRect(range: Range) {
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    right: rect.right + window.scrollX,
    bottom: rect.bottom + window.scrollY,
    left: rect.left + window.scrollX,
  };
}

/** Group-of-people glyph (Material Symbols "groups"): the community marker. */
function GroupIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M0 18v-1.575q0-1.1 1.1-1.763T4 14q.325 0 .625.013t.575.062q-.35.525-.525 1.1T4.5 16.4V18Zm6 0v-1.6q0-.8.438-1.463t1.237-1.162Q8.475 13.275 9.55 13T12 12.725q1.375 0 2.45.275t1.875.775q.8.5 1.238 1.163T18 16.4V18Zm13.5 0v-1.6q0-.65-.163-1.225t-.487-1.075q.275-.05.563-.075T20 14q1.8 0 2.9.663t1.1 1.762V18ZM4 13q-.825 0-1.412-.588T2 11q0-.85.588-1.425T4 9q.85 0 1.425.575T6 11q0 .825-.575 1.413T4 13Zm16 0q-.825 0-1.413-.588T18 11q0-.85.588-1.425T20 9q.85 0 1.425.575T22 11q0 .825-.575 1.413T20 13Zm-8-1q-1.25 0-2.125-.875T9 9q0-1.275.875-2.138T12 6q1.275 0 2.138.863T15 9q0 1.25-.862 2.125T12 12Z" />
    </svg>
  );
}

/** Small badge at the end of the anchored passage: blue community glyph on a
 *  light/dark surface following the system theme. */
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

function NotePopover({ group, projectSlug, session, myVotes, onVote, onNeedLogin, onAuthored, onNnnAuthored, nnnApi, style }: {
  group: AnchoredGroup;
  projectSlug: string | null;
  session: Session | null;
  myVotes: Map<string, Vote>;
  onVote: NoteWithActionsVote;
  onNeedLogin: () => void;
  onAuthored: (noteId: string) => void;
  onNnnAuthored: (entryId: string) => void;
  nnnApi: NnnApi;
  style: React.CSSProperties;
}) {
  const noteProps = (note: NoteRow) => ({
    note,
    myVote: myVotes.get(note.id),
    onVote,
    session,
    shareUrl: noteShareUrl(projectSlug, note.id),
    onNeedLogin,
    onAuthored,
    onNnnAuthored,
  });
  return (
    // max-h + inner scroll: a claim can stack several notes plus an open
    // composer — taller than the viewport. overscroll-contain keeps the inner
    // scroll from chaining into the host page.
    <div style={style} className="absolute bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl p-3 text-left max-h-[70vh] overflow-y-auto overscroll-contain">
      <NoteWithActions {...noteProps(group.primary)} />
      {group.alternatives.length > 0 && (
        <div className="mt-3 pl-3 border-l-[3px] border-gray-300 dark:border-gray-600 space-y-3">
          {group.alternatives.map((d) => (
            <NoteWithActions key={d.id} {...noteProps(d)} />
          ))}
        </div>
      )}
      {/* Claim-keyed like the website: the same list belongs to every note above. */}
      <NoteNotNeeded entries={group.nnn} api={nnnApi} session={session} />
    </div>
  );
}

type NoteWithActionsVote = React.ComponentProps<typeof NoteWithActions>["onVote"];

/** All badges + popovers for one page, absolutely positioned in page
 *  coordinates inside the extension's shadow-root overlay. */
export function InlineNotesApp({ groups: initialGroups, item, onPosted }: {
  groups: AnchoredGroup[];
  item: PageItem;
  onPosted: () => void;
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
  const nnnApi: NnnApi = { myVotes: myNnnVotes, onVote: handleNnnVote, onAuthored: recordNnnAuthored };
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
    // Substack's reader app scrolls an INNER container, not the document —
    // window.scrollY never changes, so positions computed once would freeze in
    // the viewport while the text moves underneath. Capture-phase scroll
    // catches every scroll container and re-derives the coordinates.
    document.addEventListener("scroll", relayout, { capture: true, passive: true });
    // Passages reflow as the host page's images/embeds finish loading — an
    // <img> gaining height fires no DOM mutation, so badge positions (cached
    // page coordinates) would go stale and drift far from their passage.
    // Re-derive them whenever the document's height changes, not just on resize.
    const resizeObserver = new ResizeObserver(relayout);
    resizeObserver.observe(document.body);
    // A click on the host page (outside our shadow root) closes the popover.
    const onDown = () => setOpenClaim(null);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", relayout);
      document.removeEventListener("scroll", relayout, { capture: true } as EventListenerOptions);
      resizeObserver.disconnect();
      document.removeEventListener("mousedown", onDown);
      cancelAnimationFrame(raf);
    };
  }, []);

  // The tint itself is a CSS highlight — not an element, so it can't receive
  // events. Hit-test host-page clicks against each claim's range instead, so
  // clicking a tinted passage opens its note like clicking the badge does.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Clicks inside our own overlay bubble out of the shadow root too — the
      // popover overlaps page text, so without this guard a vote click would
      // also hit-test the passage underneath and open ITS note.
      if (e.composedPath().some((n) => (n as Element).tagName === "COMMON-NOTES-UI")) return;
      // A drag-selection (e.g. selecting text to write a note on) ends in a
      // click too — don't hijack it.
      if (!window.getSelection()?.isCollapsed) return;
      for (const group of groups) {
        for (const rect of group.range.getClientRects()) {
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            setOpenClaim(group.claimId);
            return;
          }
        }
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [groups]);

  // Requests from the popup (scroll to the first note) and the background's
  // context menu (write a note on the current selection).
  useEffect(() => {
    const first = groups[0];
    const listener = (message: unknown) => {
      const { type, selection } = (message as { type?: string; selection?: string }) ?? {};
      if (type === "cn-scroll-to-notes" && first) {
        first.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        setOpenClaim(first.claimId);
      }
      if (type === "cn-write-note" && selection?.trim()) setWriteSelection(selection.trim());
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    return () => runtime?.onMessage.removeListener(listener);
  }, [groups]);

  const positioned = useMemo(() => groups.map((group) => {
    const rect = pageRect(group.range);
    // Clamp the popover into the viewport width; drop below the passage.
    const popLeft = Math.max(
      VIEWPORT_MARGIN + window.scrollX,
      Math.min(rect.left, window.scrollX + window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
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
        width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
        zIndex: 2,
      } satisfies React.CSSProperties,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [groups, layoutTick]);

  return (
    // Absorb both event kinds: mousedown would close the popover via the
    // document listener above; click would leak to the host page and to our
    // own passage hit-test.
    <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {signInHint && (
        <div className="fixed top-4 right-4 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-3">
          Sign in from the Common Notes toolbar icon to vote or write notes.
          <button onClick={dismissSignInHint} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
        </div>
      )}
      {writeSelection && (
        <WriteNoteOverlay
          item={item}
          selection={writeSelection}
          session={session}
          onClose={() => setWriteSelection(null)}
          onPosted={onPosted}
        />
      )}
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
              nnnApi={nnnApi}
              style={popoverStyle}
            />
          )}
        </div>
      ))}
    </div>
  );
}
