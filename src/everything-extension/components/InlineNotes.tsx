import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { VoteRatings } from "../../dashboard-shared/Ratings";
import { NoteBox, AlternativeNote } from "../../everything-web/src/components/NoteCard";
import { NoteMenu } from "../../everything-web/src/components/NoteMenu";
import type { Vote } from "../../everything-shared/votes";
import type { NoteRow } from "../../everything-shared/types";
import type { PageItem } from "../../everything-shared/notesQuery";
import { noteShareUrl } from "../utils/share";
import { useNoteVoting, replaceNoteInGroup } from "./useNoteVoting";
import { WriteNoteOverlay } from "./WriteNoteOverlay";

/** One anchored claim: its notes (promoted order) and where it sits on the page. */
export interface AnchoredGroup {
  claimId: string;
  primary: NoteRow;
  alternatives: NoteRow[];
  range: Range;
}

const BADGE_SIZE = 20;
const BADGE_GAP = 4; // px between the passage's end and the badge
const POPOVER_WIDTH = 400;
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

/** Small blue "n" dot at the end of the anchored passage. */
function Badge({ open, onClick, style }: { open: boolean; onClick: () => void; style: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      title="Community note on this passage"
      aria-expanded={open}
      style={style}
      className={`absolute flex items-center justify-center rounded-full text-white text-xs font-bold shadow transition-transform hover:scale-110 ${open ? "bg-blue-700" : "bg-blue-600"}`}
    >
      n
    </button>
  );
}

function NotePopover({ group, projectSlug, session, myVotes, onVote, onNeedLogin, style }: {
  group: AnchoredGroup;
  projectSlug: string | null;
  session: Session | null;
  myVotes: Map<string, Vote>;
  onVote: (note: NoteRow, vote: Vote) => void;
  onNeedLogin: () => void;
  style: React.CSSProperties;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const note = group.primary;
  return (
    <div style={style} className="absolute bg-white rounded-xl border border-gray-200 shadow-xl p-3 text-left">
      <NoteBox note={note} sourcesOpen={sourcesOpen}>
        <VoteRatings
          helpful={note.helpful_count}
          somewhatHelpful={note.somewhat_helpful_count}
          notHelpful={note.not_helpful_count}
          myVote={myVotes.get(note.id)}
          onVote={(vote) => onVote(note, vote)}
        />
      </NoteBox>
      <NoteMenu
        note={note}
        shareUrl={noteShareUrl(projectSlug, note.id)}
        session={session}
        onNeedLogin={onNeedLogin}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((o) => !o)}
      />
      {group.alternatives.length > 0 && (
        <div className="mt-3 pl-3 border-l-[3px] border-gray-300 space-y-3">
          {group.alternatives.map((d) => (
            <AlternativeNote
              key={d.id}
              note={d}
              myVote={myVotes.get(d.id)}
              onVote={onVote}
              session={session}
              shareUrl={noteShareUrl(projectSlug, d.id)}
              onNeedLogin={onNeedLogin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
  const { session, myVotes, handleVote, onNeedLogin, signInHint, dismissSignInHint } = useNoteVoting(
    (updated) => setGroups((prev) => prev.map((g) => replaceNoteInGroup(g, updated))),
  );
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
    // A click on the host page (outside our shadow root) closes the popover.
    const onDown = () => setOpenClaim(null);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", relayout);
      document.removeEventListener("mousedown", onDown);
      cancelAnimationFrame(raf);
    };
  }, []);

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
    <div onMouseDown={(e) => e.stopPropagation()}>
      {signInHint && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-sm text-gray-700 flex items-center gap-3">
          Sign in from the Common Notes toolbar icon to vote or write notes.
          <button onClick={dismissSignInHint} className="text-gray-400 hover:text-gray-600">✕</button>
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
              style={popoverStyle}
            />
          )}
        </div>
      ))}
    </div>
  );
}
