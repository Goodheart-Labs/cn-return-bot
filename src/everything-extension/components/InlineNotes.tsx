import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { VoteRatings } from "../../dashboard-shared/Ratings";
import { NoteBox, AlternativeNote } from "../../everything-web/src/components/NoteCard";
import { NoteMenu } from "../../everything-web/src/components/NoteMenu";
import { useSession } from "../../everything-shared/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { fetchNote } from "../../everything-shared/notesQuery";
import type { NoteRow } from "../../everything-shared/types";
import { noteShareUrl } from "../utils/share";

/** One anchored claim: its notes (promoted order) and where it sits on the page. */
export interface AnchoredGroup {
  claimId: string;
  primary: NoteRow;
  alternatives: NoteRow[];
  range: Range;
}

const BADGE_SIZE = 20;
const POPOVER_WIDTH = 400;

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
export function InlineNotesApp({ groups: initialGroups, projectSlug }: {
  groups: AnchoredGroup[];
  projectSlug: string | null;
}) {
  const { session } = useSession();
  const [groups, setGroups] = useState(initialGroups);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [signInHint, setSignInHint] = useState(false);
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const onNeedLogin = () => setSignInHint(true);
  // Bumped on resize so positions derived from ranges recompute.
  const [, setLayoutTick] = useState(0);

  useEffect(() => setGroups(initialGroups), [initialGroups]);

  useEffect(() => {
    if (!session) return setMyVotes(new Map());
    fetchMyVotes().then(setMyVotes);
  }, [session]);

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

  // Scroll-to-first-note request from the popup.
  useEffect(() => {
    const first = groups[0];
    const listener = (message: unknown) => {
      if ((message as { type?: string })?.type === "cn-scroll-to-notes" && first) {
        first.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        setOpenClaim(first.claimId);
      }
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    return () => runtime?.onMessage.removeListener(listener);
  }, [groups]);

  const replaceNote = (updated: NoteRow) => {
    setGroups((prev) => prev.map((g) => ({
      ...g,
      primary: g.primary.id === updated.id ? { ...updated, claim: g.primary.claim } : g.primary,
      alternatives: g.alternatives.map((a) => (a.id === updated.id ? { ...updated, claim: a.claim } : a)),
    })));
  };

  const handleVote = async (note: NoteRow, vote: Vote) => {
    if (!session) return onNeedLogin();
    const current = myVotes.get(note.id);
    const next = new Map(myVotes);
    if (current === vote) {
      next.delete(note.id);
      setMyVotes(next);
      await clearVote(note.id);
    } else {
      next.set(note.id, vote);
      setMyVotes(next);
      await castVote(note.id, session.user.id, vote);
    }
    const fresh = await fetchNote(note.id); // trigger-computed counts
    if (fresh) replaceNote(fresh);
  };

  const positioned = useMemo(() => groups.map((group) => {
    const rect = pageRect(group.range);
    // Clamp the popover into the viewport width; drop below the passage.
    const popLeft = Math.max(8 + window.scrollX, Math.min(rect.left, window.scrollX + window.innerWidth - POPOVER_WIDTH - 8));
    return {
      group,
      badgeStyle: {
        top: rect.top - BADGE_SIZE / 2,
        left: rect.right + 4,
        width: BADGE_SIZE,
        height: BADGE_SIZE,
      } satisfies React.CSSProperties,
      popoverStyle: {
        top: rect.bottom + 8,
        left: popLeft,
        width: Math.min(POPOVER_WIDTH, window.innerWidth - 16),
        zIndex: 2,
      } satisfies React.CSSProperties,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [groups, openClaim]);

  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      {signInHint && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-sm text-gray-700 flex items-center gap-3">
          Sign in from the Common Notes toolbar icon to vote or write notes.
          <button onClick={() => setSignInHint(false)} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
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
