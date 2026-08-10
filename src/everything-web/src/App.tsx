import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useLiveData } from "./lib/useLiveData";
import { useSession, signOut } from "../../everything-shared/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes } from "../../everything-shared/noteNotNeeded";
import { donationPair, priorTally } from "./lib/donationScoring";
import { noteTally, probabilityHelpful, probabilityHelpfulAfter } from "../../everything-shared/noteBelief";
import { saveDonation, usePreferredCharity, type MintedDonation } from "./lib/donations";
import { readRoute, pushProject, pushItem, pushLeaderboard, type View } from "./lib/routing";
import { identifyUser, resetAnalytics, track } from "../../everything-shared/analytics";
import { capturePageview } from "./lib/analytics";
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
import { Leaderboard } from "./components/Leaderboard";
import { DesignMenu } from "./components/DesignMenu";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { noteStatus, totalVotes } from "../../everything-shared/noteScore";

const NO_NNN: NnnRow[] = [];

/** The three vote counts a note's feed position is derived from. */
type RankTally = Pick<NoteRow, "helpful_count" | "somewhat_helpful_count" | "not_helpful_count">;

/** A labelled band of the feed. Rendered only when it has notes, so a project
 *  with nothing rated yet shows no dividers at all. */
function NoteSection({ label, notes, render }: {
  label: string;
  notes: NoteRow[];
  render: (note: NoteRow) => ReactNode;
}) {
  if (notes.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-3 pt-4 max-w-[40rem] mx-auto w-full xl:max-w-none" role="separator">
        <span className="flex-1 border-t-2 border-dotted border-gray-300" />
        <span className="text-xs text-gray-400">{label}</span>
        <span className="flex-1 border-t-2 border-dotted border-gray-300" />
      </div>
      {notes.map(render)}
    </>
  );
}

export function App() {
  const { projects, items, notes, nnn, loaded } = useLiveData();
  const { session, event: authEvent } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which top-level view — the note feed or the rating leaderboard.
  const [view, setView] = useState<View>(() => readRoute().view);
  // Item filter within the project (episode / post / page) — null = all items.
  const [itemFilter, setItemFilter] = useState<string | null>(() => readRoute().item);
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [myNnnVotes, setMyNnnVotes] = useState<Map<string, Vote>>(new Map());
  // A fresh vote's donation starts at the remembered charity; the donation
  // box lets the voter redirect it afterwards.
  const [preferredCharity] = usePreferredCharity();
  const [loginOpen, setLoginOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);

  useEffect(() => {
    if (session) {
      fetchMyVotes().then(setMyVotes);
      fetchMyNnnVotes().then(setMyNnnVotes);
    } else {
      setMyVotes(new Map());
      setMyNnnVotes(new Map());
    }
  }, [session?.user.id]);

  // Attribute analytics to the person once signed in; drop the link on sign-out.
  // Reset ONLY on a real sign-out transition — the session is also null on
  // every anonymous page load and briefly on signed-in reloads, and resetting
  // then would mint a fresh anonymous id each time (inflating visitor counts
  // and breaking the anonymous→person merge).
  const signedInFor = useRef<string | null>(null);
  const identifiedAs = useRef<string | null>(null);
  useEffect(() => {
    if (session) {
      identifiedAs.current = session.user.id;
      identifyUser(session.user.id, { auth_provider: session.user.app_metadata?.provider });
    } else if (identifiedAs.current) {
      identifiedAs.current = null;
      resetAnalytics();
      signedInFor.current = null; // allow a fresh sign_in if they log back in
    }
  }, [session?.user.id]);

  // The sign-in funnel step. SIGNED_IN fires on a real sign-in (email link /
  // OAuth return), not on a returning user's restored session (INITIAL_SESSION);
  // the per-user guard drops the duplicate SIGNED_IN supabase-js emits on tab
  // refocus, so the count stays one-per-sign-in.
  useEffect(() => {
    if (authEvent === "SIGNED_IN" && session && signedInFor.current !== session.user.id) {
      signedInFor.current = session.user.id;
      track("signed_in", { provider: session.user.app_metadata?.provider });
    }
  }, [authEvent, session?.user.id]);

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

  // Claim id → its note-not-needed entries, oldest first (age order, not
  // votes — no teleporting). The same list renders under every note card on
  // that claim.
  const nnnByClaim = useMemo(() => {
    const byClaim = new Map<string, NnnRow[]>();
    const sorted = [...nnn.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const entry of sorted) {
      const list = byClaim.get(entry.claim_id) ?? [];
      list.push(entry);
      byClaim.set(entry.claim_id, list);
    }
    return byClaim;
  }, [nnn]);

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
  // Each capture comes AFTER the pushState so the event carries the new URL —
  // posthog's own pageview detection only fires on pathname changes and our
  // routing is all query params, so these manual captures are the only way
  // in-app navigation gets counted.
  const selectProject = (id: string) => {
    setView("notes");
    setSelectedId(id);
    setItemFilter(null);
    const slug = projects.find((p) => p.id === id)?.slug;
    if (slug) pushProject(slug);
    capturePageview();
  };
  const selectItem = (itemId: string | null) => {
    setItemFilter(itemId);
    const slug = projects.find((p) => p.id === selectedId)?.slug;
    if (slug) pushItem(slug, itemId);
    capturePageview();
  };
  const selectLeaderboard = () => {
    setView("leaderboard");
    pushLeaderboard();
    capturePageview();
  };
  useEffect(() => {
    const onPop = () => {
      capturePageview();
      const route = readRoute();
      setView(route.view);
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

  // Casts the vote and mints its donation: the outcome-contingent pair is
  // computed from the pre-vote tally (frozen at vote time) and upserted keyed
  // to the vote row. Returns the cast (null on retract / signed-out / own
  // note — retracting cascades the donation away, own-note votes mint none).
  const handleVote = async (note: NoteRow, vote: Vote): Promise<MintedDonation | null> => {
    if (!session) {
      // An anonymous reader hit the vote wall — the funnel's sign-in prompt.
      track("vote_gated_login", { note_id: note.id });
      setLoginOpen(true);
      return null;
    }
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
    const voteId = await castVote(note.id, session.user.id, vote, "web");
    if (!voteId) return null;
    if (note.author_id === session.user.id) return null;
    const pair = donationPair(priorTally(note, current), vote);
    // A backend without migration 061 rejects the pair columns — keep the vote,
    // just don't promise a donation the ledger didn't record.
    const { error } = await saveDonation(voteId, preferredCharity, pair);
    return error ? null : { voteId, charity: preferredCharity, pair };
  };

  const handleNnnVote = async (entry: NnnRow, vote: Vote) => {
    if (!session) {
      setLoginOpen(true);
      return;
    }
    const current = myNnnVotes.get(entry.id);
    const next = new Map(myNnnVotes);
    if (current === vote) {
      next.delete(entry.id);
      setMyNnnVotes(next);
      await clearNnnVote(entry.id);
    } else {
      next.set(entry.id, vote);
      setMyNnnVotes(next);
      await castNnnVote(entry.id, session.user.id, vote);
    }
  };

  // The DB self-vote triggers make a just-posted note/entry start with its
  // author's helpful vote — mirror that into the local vote maps so the pills
  // light up without a refetch.
  const nnnApi = {
    myVotes: myNnnVotes,
    onVote: handleNnnVote,
    onAuthored: (entryId: string) =>
      setMyNnnVotes((m) => new Map(m).set(entryId, 1)),
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
  const rankTallies = useRef(new Map<string, RankTally>());
  // Ranking is frozen per page load: a note is ranked by the vote tally it
  // carried when it first appeared, so no card ever moves under the reader —
  // least of all the one they just voted on. The card itself stays live (its
  // badge, counts and donation all read the real tally); reloading drops the
  // freeze and the feed re-sorts.
  const effective = (n: NoteRow): NoteRow => {
    const frozen = rankTallies.current.get(n.id);
    if (frozen) return { ...n, ...frozen };
    rankTallies.current.set(n.id, {
      helpful_count: n.helpful_count,
      somewhat_helpful_count: n.somewhat_helpful_count,
      not_helpful_count: n.not_helpful_count,
    });
    return n;
  };
  const contentIdx = new Map(orderedNotes.map((n, i) => [n.id, i]));
  // p is a continued-fraction evaluation, so derive each note's ranking inputs
  // once here rather than inside the comparators below — a comparator would
  // re-evaluate it O(n log n) times on every render.
  //
  // One predicate decides the badge, the section and the donation payout:
  // noteStatus (lib/noteScore.ts), the p-based rating rule.
  const ranking = new Map(
    orderedNotes.map((n) => {
      const e = effective(n);
      return [
        n.id,
        {
          status: noteStatus(e),
          p: probabilityHelpful(noteTally(e)),
          pAfterOneHelpful: probabilityHelpfulAfter(e, 1),
          votes: totalVotes(e),
        },
      ];
    }),
  );
  const rankOf = (n: NoteRow) => ranking.get(n.id)!;
  // A note written against source text the author has since edited may no longer
  // apply, whatever its rating — so it drops below everything else rather than
  // sitting among notes about the live text. Outranks the rating status.
  const staleSource = (n: NoteRow) => n.claim?.updated_quote != null;
  const current = orderedNotes.filter((n) => !staleSource(n));
  const needRatings = current.filter((n) => rankOf(n).status === "needs_ratings");
  const helpfulNotes = current.filter((n) => rankOf(n).status === "helpful");
  const unhelpfulNotes = current.filter((n) => rankOf(n).status === "not_helpful");
  const staleSourceNotes = orderedNotes.filter(staleSource);
  // Every group is ordered by p, the latent-quality model's estimate that the
  // note ends up rated helpful (see lib/noteBelief.ts) — so the whole feed reads
  // as one gradient, most-uncertain at the top down to most-settled.
  // Needs ratings: lead with the note a single Helpful vote would carry
  // furthest — the closest to resolving — so attention lands where it settles
  // something. Equal p (identical tallies) → oldest first, they've waited longest.
  needRatings.sort(
    (a, b) =>
      rankOf(b).pAfterOneHelpful - rankOf(a).pAfterOneHelpful ||
      a.created_at.localeCompare(b.created_at) ||
      contentIdx.get(a.id)! - contentIdx.get(b.id)!,
  );
  // Rated helpful: ascending p, so the most confidently helpful sits lowest.
  helpfulNotes.sort(
    (a, b) =>
      rankOf(a).p - rankOf(b).p ||
      rankOf(a).votes - rankOf(b).votes ||
      contentIdx.get(a.id)! - contentIdx.get(b.id)!,
  );
  // Rated unhelpful: descending p, so the least helpful sinks lowest — the
  // mirror of the helpful group, continuing the same gradient.
  const bestFirst = (a: NoteRow, b: NoteRow) =>
    rankOf(b).p - rankOf(a).p || contentIdx.get(a.id)! - contentIdx.get(b.id)!;
  unhelpfulNotes.sort(bestFirst);
  staleSourceNotes.sort(bestFirst);

  const renderCard = (note: NoteRow) => (
    <NoteCard
      key={note.id}
      note={note}
      improvements={improvementsByOriginal.get(note.id) ?? []}
      nnnEntries={nnnByClaim.get(note.claim_id) ?? NO_NNN}
      nnnApi={nnnApi}
      projectSlug={selected?.slug ?? ""}
      myVote={myVotes.get(note.id)}
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
        view={view}
        onSelect={selectProject}
        onSelectLeaderboard={selectLeaderboard}
      />

      <main className="flex-1 max-w-3xl md:max-w-[96rem] mx-auto px-4 md:px-8 py-8 w-full">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-2xl font-extrabold">
            {view === "leaderboard" ? "Rating leaderboard" : selected?.name ?? ""}
          </h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setWriteOpen(true);
                // The modal is a "get the extension" teaser — each open is a
                // web user asking for a write flow, i.e. extension demand.
                track("write_note_teaser_shown");
              }}
              className="text-sm font-medium text-blue-600 hover:underline shrink-0"
            >
              Write a note
            </button>
            <AuthCorner session={session} onSignIn={() => setLoginOpen(true)} onSignOut={() => signOut()} />
          </div>
        </div>
        {view === "leaderboard" && <Leaderboard session={session} myVoteCount={myVotes.size} />}
        {view === "notes" && loaded && (
          <ItemChips
            items={projectItems}
            noteCounts={itemNoteCounts}
            selected={activeItem}
            onSelect={selectItem}
          />
        )}
        {view === "notes" && !loaded && <p className="text-gray-400">Loading…</p>}
        {view === "notes" && loaded && orderedNotes.length === 0 && (
          <p className="text-gray-400">No notes yet for this project.</p>
        )}
        {view === "notes" && (
        <div className="space-y-4">
          {needRatings.map(renderCard)}
          <NoteSection label="Helpful notes" notes={helpfulNotes} render={renderCard} />
          <NoteSection label="Unhelpful notes" notes={unhelpfulNotes} render={renderCard} />
          <NoteSection label="Source has since changed" notes={staleSourceNotes} render={renderCard} />
        </div>
        )}
      </main>

      <DesignMenu />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <WriteNoteModal open={writeOpen} onClose={() => setWriteOpen(false)} />
    </div>
  );
}
