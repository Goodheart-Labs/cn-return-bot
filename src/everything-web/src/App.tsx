import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useLiveData } from "./lib/useLiveData";
import { useSession, signOut } from "./lib/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "./lib/votes";
import { castCommentVote, clearCommentVote, fetchMyCommentVotes } from "./lib/comments";
import { donationPair, priorTally, type VoteCast } from "./lib/donationScoring";
import { saveDonation, usePreferredCharity } from "./lib/donations";
import { readRoute, pushProject, pushItem } from "./lib/routing";
import { Sidebar } from "./components/Sidebar";

function AuthCorner({ session, onSignIn, onSignOut }: {
  session: Session | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (!session) {
    return (
      <button onClick={onSignIn} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 shrink-0">
        Sign in to vote
      </button>
    );
  }
  const who = session.user.email ?? session.user.user_metadata?.user_name ?? "signed in";
  return (
    <div className="text-sm text-gray-500 flex items-center gap-3 shrink-0 min-w-0">
      <span className="truncate max-w-[16rem]" title={who}>{who}</span>
      <button onClick={onSignOut} className="text-blue-600 hover:underline">Sign out</button>
    </div>
  );
}
import { LoginModal } from "./components/LoginModal";
import { WriteNoteModal } from "./components/WriteNoteModal";
import { NoteCard } from "./components/NoteCard";
import { ItemChips } from "./components/ItemChips";
import { DesignMenu } from "./components/DesignMenu";
import type { CommentRow, NoteRow } from "./lib/types";
import { isLocked, totalVotes, weight } from "./lib/noteScore";

const EMPTY_COMMENT_TREE = new Map<string | null, CommentRow[]>();

export function App() {
  const { projects, items, notes, comments, loaded } = useLiveData();
  const { session } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Item filter within the project (episode / post / page) — null = all items.
  const [itemFilter, setItemFilter] = useState<string | null>(() => readRoute().item);
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [myCommentVotes, setMyCommentVotes] = useState<Map<string, Vote>>(new Map());
  // A fresh vote's donation starts at the remembered charity; the reasoning
  // box lets the voter redirect it afterwards.
  const [preferredCharity] = usePreferredCharity();
  const [loginOpen, setLoginOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  // After a vote, hold the note's list position briefly (misclick grace) —
  // maps note id → a snapshot of its vote counts at vote time. Ranking uses
  // the snapshot while held, so the card keeps its exact slot instead of
  // teleporting; re-votes re-arm the timer but keep the frozen slot. Cleared
  // by the timer, then the live counts decide again.
  const RESORT_GRACE_MS = 6000;
  type HeldCounts = Pick<NoteRow, "helpful_count" | "somewhat_helpful_count" | "not_helpful_count">;
  const [voteHolds, setVoteHolds] = useState<Map<string, HeldCounts>>(new Map());
  const holdTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (session) {
      fetchMyVotes().then(setMyVotes);
      fetchMyCommentVotes().then(setMyCommentVotes);
    } else {
      setMyVotes(new Map());
      setMyCommentVotes(new Map());
    }
  }, [session?.user.id]);

  // Every note is its own card — AI note, user note, improvement alike; the
  // feed ranking below treats them uniformly. An improvement is tied to its
  // original only by a jump-link (improvementsByOriginal is the reverse index
  // of improved_from_note_id).
  const { notesByItem, improvementsByOriginal } = useMemo(() => {
    const byItem = new Map<string, NoteRow[]>();
    const improvements = new Map<string, NoteRow[]>();
    for (const note of notes.values()) {
      const itemId = note.claim?.item_id;
      if (itemId) {
        const cards = byItem.get(itemId) ?? [];
        cards.push(note);
        byItem.set(itemId, cards);
      }
      if (note.improved_from_note_id) {
        const list = improvements.get(note.improved_from_note_id) ?? [];
        list.push(note);
        improvements.set(note.improved_from_note_id, list);
      }
    }
    return { notesByItem: byItem, improvementsByOriginal: improvements };
  }, [notes]);

  // Per-note comment trees: note id → (parent comment id | null → children,
  // oldest first). Comments rank by age, not votes — no teleporting threads.
  const commentsByNote = useMemo(() => {
    const byNote = new Map<string, Map<string | null, CommentRow[]>>();
    const sorted = [...comments.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const comment of sorted) {
      const tree = byNote.get(comment.note_id) ?? new Map<string | null, CommentRow[]>();
      const siblings = tree.get(comment.parent_comment_id) ?? [];
      siblings.push(comment);
      tree.set(comment.parent_comment_id, siblings);
      byNote.set(comment.note_id, tree);
    }
    return byNote;
  }, [comments]);

  // Initial project: the ?project= slug from the URL, else the first project
  // (by sort order) that actually has content.
  useEffect(() => {
    if (selectedId || projects.length === 0) return;
    const fromUrl = projects.find((p) => p.slug === readRoute().project);
    if (fromUrl) return setSelectedId(fromUrl.id);
    const withItems = new Set([...items.values()].map((i) => i.project_id));
    setSelectedId(projects.find((p) => withItems.has(p.id))?.id ?? projects[0]!.id);
  }, [projects, items, selectedId]);

  // Selecting a project updates the URL; Back/Forward restores the selection.
  const selectProject = (id: string) => {
    setSelectedId(id);
    setItemFilter(null);
    const slug = projects.find((p) => p.id === id)?.slug;
    if (slug) pushProject(slug);
  };
  const selectItem = (itemId: string | null) => {
    setItemFilter(itemId);
    const slug = projects.find((p) => p.id === selectedId)?.slug;
    if (slug) pushItem(slug, itemId);
  };
  useEffect(() => {
    const onPop = () => {
      const route = readRoute();
      const p = projects.find((pp) => pp.slug === route.project);
      if (p) setSelectedId(p.id);
      setItemFilter(route.item);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [projects]);

  // On a shared ?note= link, scroll to that note once its card has rendered.
  // Re-fire a few times as the YouTube iframes load and shift layout beneath it.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !loaded) return;
    const { note } = readRoute();
    if (!note) {
      scrolledRef.current = true;
      return;
    }
    if (!document.getElementById(`note-${note}`)) return; // wait for its card
    scrolledRef.current = true;
    for (const ms of [0, 400, 1000, 1800]) {
      setTimeout(() => document.getElementById(`note-${note}`)?.scrollIntoView({ block: "start" }), ms);
    }
  }, [loaded, notes, selectedId]);

  const holdPosition = (note: NoteRow) => {
    // Freeze the ranking inputs only on the first vote of the window — a
    // re-vote keeps the frozen slot and just re-arms the timer.
    setVoteHolds((m) =>
      m.has(note.id)
        ? m
        : new Map(m).set(note.id, {
            helpful_count: note.helpful_count,
            somewhat_helpful_count: note.somewhat_helpful_count,
            not_helpful_count: note.not_helpful_count,
          }),
    );
    clearTimeout(holdTimers.current.get(note.id));
    holdTimers.current.set(
      note.id,
      setTimeout(() => {
        setVoteHolds((m) => {
          const next = new Map(m);
          next.delete(note.id);
          return next;
        });
      }, RESORT_GRACE_MS),
    );
  };

  // Casts the vote and mints its donation: the outcome-contingent pair is
  // computed from the pre-vote tally (frozen at vote time) and upserted keyed
  // to the vote row. Returns the cast (null on retract / signed-out / own
  // note — retracting cascades the donation away, own-note votes mint none).
  const handleVote = async (note: NoteRow, vote: Vote): Promise<VoteCast | null> => {
    if (!session) {
      setLoginOpen(true);
      return null;
    }
    holdPosition(note);
    const current = myVotes.get(note.id);
    const next = new Map(myVotes);
    if (current === vote) {
      next.delete(note.id);
      setMyVotes(next);
      await clearVote(note.id);
      return null;
    }
    next.set(note.id, vote);
    setMyVotes(next);
    const voteId = await castVote(note.id, session.user.id, vote);
    if (!voteId || note.author_id === session.user.id) return null;
    const pair = donationPair(priorTally(note, current), vote);
    // A backend without migration 061 rejects the pair columns — keep the vote,
    // just don't promise a donation the ledger didn't record.
    const { error } = await saveDonation(voteId, preferredCharity, pair);
    return error ? null : { voteId, pair };
  };

  const handleCommentVote = async (comment: CommentRow, vote: Vote) => {
    if (!session) {
      setLoginOpen(true);
      return;
    }
    const current = myCommentVotes.get(comment.id);
    const next = new Map(myCommentVotes);
    if (current === vote) {
      next.delete(comment.id);
      setMyCommentVotes(next);
      await clearCommentVote(comment.id);
    } else {
      next.set(comment.id, vote);
      setMyCommentVotes(next);
      await castCommentVote(comment.id, session.user.id, vote);
    }
  };

  // The DB self-vote triggers make a just-posted note/comment start with its
  // author's helpful vote — mirror that into the local vote maps so the pills
  // light up without a refetch.
  const commentsApi = {
    myVotes: myCommentVotes,
    onVote: handleCommentVote,
    onAuthored: (commentId: string) =>
      setMyCommentVotes((m) => new Map(m).set(commentId, 1)),
  };
  const noteAuthored = (noteId: string) => setMyVotes((m) => new Map(m).set(noteId, 1));

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  // The project's items that actually have notes, newest first — feeds both the
  // chip row and the note feed.
  const projectItems = [...items.values()]
    .filter((i) => i.project_id === selectedId && (notesByItem.get(i.id)?.length ?? 0) > 0)
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at));
  const itemNoteCounts = new Map(projectItems.map((i) => [i.id, notesByItem.get(i.id)!.length]));
  // Ignore a stale/foreign ?item= param rather than show an empty feed.
  const activeItem = projectItems.some((i) => i.id === itemFilter) ? itemFilter : null;
  // Keep an improvement chain grouped behind its root note in content order:
  // co-claim notes share start_seconds, so tie-break on the chain root's age,
  // originals before improvements, then own age — deterministic for contentIdx.
  const rootCreatedAt = (n: NoteRow): string => {
    let cur = n;
    const seen = new Set<string>();
    while (cur.improved_from_note_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = notes.get(cur.improved_from_note_id);
      if (!parent) break;
      cur = parent;
    }
    return cur.created_at;
  };
  // A project is just its notes — no per-item headers. Newest content first,
  // then in content order (clip timestamp) within an item. The item chips
  // narrow this to one item; ranking below applies unchanged to the subset.
  const orderedNotes = projectItems
    .filter((i) => !activeItem || i.id === activeItem)
    .flatMap((item) =>
      (notesByItem.get(item.id) ?? []).sort(
        (a, b) =>
          (a.claim?.start_seconds ?? 0) - (b.claim?.start_seconds ?? 0) ||
          rootCreatedAt(a).localeCompare(rootCreatedAt(b)) ||
          Number(!!a.improved_from_note_id) - Number(!!b.improved_from_note_id) ||
          a.created_at.localeCompare(b.created_at),
      ),
    );
  // Nathan's ranking spec (prep doc, #7): a note "locks in" as a real note at
  // >=5 ratings with net-positive score; under that it's a draft. Feed order:
  // top 3 slots go to the best real notes, then real/draft interleave 1:1,
  // then the draft long tail. Net-negative notes sink below a labeled divider.
  // While a note is held (just-voted grace window), rank it by its frozen
  // count snapshot so it keeps its exact slot; display still shows live counts.
  const effective = (n: NoteRow): NoteRow => {
    const held = voteHolds.get(n.id);
    return held ? { ...n, ...held } : n;
  };
  const score = (n: NoteRow) => {
    const e = effective(n);
    return totalVotes(e) === 0 ? 0 : weight(e) / totalVotes(e);
  };
  const isUnderwater = (n: NoteRow) => {
    const e = effective(n);
    return e.not_helpful_count > e.helpful_count + e.somewhat_helpful_count;
  };

  // Really unhelpful = enough ratings to be confident (>=5) and a weighted
  // score under 0.4 — those collapse into a drawer at the bottom; mildly
  // negative notes stay visible below the dotted line.
  const isBuried = (n: NoteRow) => totalVotes(effective(n)) >= 5 && score(n) < 0.4;
  const aboveWater = orderedNotes.filter((n) => !isUnderwater(n));
  const underwaterNotes = orderedNotes.filter((n) => isUnderwater(n) && !isBuried(n));
  const buriedNotes = orderedNotes.filter((n) => isUnderwater(n) && isBuried(n));
  // Rank by score, then vote volume, then keep content order stable.
  const contentIdx = new Map(orderedNotes.map((n, i) => [n.id, i]));
  const ranked = [...aboveWater].sort(
    (a, b) =>
      score(b) - score(a) ||
      totalVotes(effective(b)) - totalVotes(effective(a)) ||
      contentIdx.get(a.id)! - contentIdx.get(b.id)!,
  );
  const realNotes = ranked.filter((n) => isLocked(effective(n)));
  const draftFeed = ranked.filter((n) => !isLocked(effective(n)));
  const projectNotes: NoteRow[] = [...realNotes.slice(0, 3)];
  const restReal = realNotes.slice(3);
  for (let i = 0; restReal.length > i || draftFeed.length > i * 0; i++) {
    if (i >= restReal.length && i >= draftFeed.length) break;
    if (i < restReal.length) projectNotes.push(restReal[i]!);
    if (i < draftFeed.length) projectNotes.push(draftFeed[i]!);
  }

  const renderCard = (note: NoteRow) => (
    <NoteCard
      key={note.id}
      note={note}
      improvements={improvementsByOriginal.get(note.id) ?? []}
      commentsByParent={commentsByNote.get(note.id) ?? EMPTY_COMMENT_TREE}
      commentsApi={commentsApi}
      projectSlug={selected?.slug ?? ""}
      myVote={myVotes.get(note.id)}
      holdActive={voteHolds.has(note.id)}
      onVote={handleVote}
      onAuthored={noteAuthored}
      session={session}
      onNeedLogin={() => setLoginOpen(true)}
    />
  );

  return (
    <div className="md:flex">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
      />

      <main className="flex-1 max-w-3xl md:max-w-[96rem] mx-auto px-4 md:px-8 py-8 w-full">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-2xl font-extrabold">{selected?.name ?? ""}</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => (session ? setWriteOpen(true) : setLoginOpen(true))}
              className="text-sm font-medium text-blue-600 hover:underline shrink-0"
            >
              Write a note
            </button>
            <AuthCorner session={session} onSignIn={() => setLoginOpen(true)} onSignOut={() => signOut()} />
          </div>
        </div>
        {loaded && (
          <ItemChips
            items={projectItems}
            noteCounts={itemNoteCounts}
            selected={activeItem}
            onSelect={selectItem}
          />
        )}
        {!loaded && <p className="text-gray-400">Loading…</p>}
        {loaded && orderedNotes.length === 0 && (
          <p className="text-gray-400">No notes yet for this project.</p>
        )}
        <div className="space-y-4">
          {projectNotes.map(renderCard)}
          {underwaterNotes.length > 0 && (
            <>
              <div className="flex items-center gap-3 pt-4 max-w-[40rem] mx-auto w-full xl:max-w-none" role="separator">
                <span className="flex-1 border-t-2 border-dotted border-gray-300" />
                <span className="text-xs text-gray-400">Notes with more negative votes than positive</span>
                <span className="flex-1 border-t-2 border-dotted border-gray-300" />
              </div>
              {underwaterNotes.map(renderCard)}
            </>
          )}
          {buriedNotes.length > 0 && (
            <details className="max-w-[40rem] mx-auto w-full xl:max-w-none pt-2">
              <summary className="text-xs text-gray-400 cursor-pointer select-none text-center">
                {buriedNotes.length} {buriedNotes.length === 1 ? "note" : "notes"} rated unhelpful — show
              </summary>
              <div className="space-y-4 mt-4">
                {buriedNotes.map(renderCard)}
              </div>
            </details>
          )}
        </div>
      </main>

      <DesignMenu />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {session && (
        <WriteNoteModal
          open={writeOpen}
          onClose={() => setWriteOpen(false)}
          projectId={selectedId}
          session={session}
          onAuthored={noteAuthored}
        />
      )}
    </div>
  );
}
