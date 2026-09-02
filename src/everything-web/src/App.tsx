import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BUTTON, LINK } from "../../everything-shared/ui";
import type { Session } from "@supabase/supabase-js";
import { useProjectFeed, useProjects } from "./lib/useFeedData";
import { fetchProjectIdsWithItems } from "./lib/feedData";
import { ensureUser, useSession, signOut } from "../../everything-shared/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../everything-shared/votes";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes } from "../../everything-shared/noteNotNeeded";
import { donationPair, priorTally } from "./lib/donationScoring";
import { noteTally, probabilityHelpful, probabilityHelpfulAfter } from "../../everything-shared/noteBelief";
import { saveDonation, preferredCharity, type MintedDonation } from "./lib/donations";
import { readRoute, pushProject, pushItem, pushLeaderboard, type View } from "./lib/routing";
import { identifyUser, resetAnalytics, track } from "../../everything-shared/analytics";
import { capturePageview } from "./lib/analytics";
import { Sidebar } from "./components/Sidebar";

function AuthCorner({ session, onSignIn, onSignOut }: {
  session: Session | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  // An anonymous session is invisible to the reader: it exists only so their
  // votes have an account to live on. The corner keeps offering the real
  // sign-in, which upgrades that account in place.
  if (!session || session.user.is_anonymous) {
    return (
      <button onClick={onSignIn} className={`${BUTTON} shrink-0`}>
        Sign in
      </button>
    );
  }
  const who = session.user.email ?? session.user.user_metadata?.user_name ?? "signed in";
  return (
    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-3 shrink-0 min-w-0">
      <span className="truncate max-w-[16rem]" title={who}>{who}</span>
      <button onClick={onSignOut} className={LINK}>Sign out</button>
    </div>
  );
}
import { LoginModal } from "./components/LoginModal";
import { WriteNoteModal } from "./components/WriteNoteModal";
import { NoteCard } from "./components/NoteCard";
import { ItemChips } from "./components/ItemChips";
import { Leaderboard } from "./components/Leaderboard";
import { SystemTheme } from "./components/SystemTheme";
import type { NnnRow, NoteRow } from "../../everything-shared/types";
import { noteStatus, totalVotes } from "../../everything-shared/noteScore";

const NO_NNN: NnnRow[] = [];

/** The three vote counts a note's feed position is derived from. */
type RankTally = Pick<NoteRow, "helpful_count" | "somewhat_helpful_count" | "not_helpful_count">;

/** A labelled band of the feed. It renders only when it holds notes, so a project
 *  with nothing rated yet shows no dividers at all. */
function NoteSection({ label, notes, render }: {
  label: string;
  notes: NoteRow[];
  render: (note: NoteRow) => ReactNode;
}) {
  if (notes.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-3 py-2 max-w-[40rem] mx-auto w-full" role="separator">
        <span className="flex-1 border-t-2 border-dotted border-gray-300 dark:border-gray-700" />
        <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
        <span className="flex-1 border-t-2 border-dotted border-gray-300 dark:border-gray-700" />
      </div>
      {notes.map(render)}
    </>
  );
}

export function App() {
  const { projects, failed: projectsFailed } = useProjects();
  const { session, event: authEvent } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The feed holds one project at a time. Selecting another project loads that
  // project's items, notes and entries and drops the previous project's.
  const { items, notes, nnn, loaded, failed: feedFailed, retry: retryFeed } = useProjectFeed(selectedId);
  // Which top-level view is showing: the note feed or the rating leaderboard.
  const [view, setView] = useState<View>(() => readRoute().view);
  // Which item inside the project the feed is narrowed to. An item is one
  // episode, one post or one page. Null means every item.
  const [itemFilter, setItemFilter] = useState<string | null>(() => readRoute().item);
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [myNnnVotes, setMyNnnVotes] = useState<Map<string, Vote>>(new Map());
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

  // Once the user signs in we attach analytics to their account, and we drop that
  // link again when they sign out. We only reset on a real sign-out. The session
  // is also null on every anonymous page load, and briefly on a signed-in reload.
  // Resetting in those cases would mint a fresh anonymous id each time, which
  // would inflate the visitor count and break the merge of a visitor's anonymous
  // history into their account.
  const signedInFor = useRef<string | null>(null);
  const identifiedAs = useRef<string | null>(null);
  useEffect(() => {
    // An anonymous session is not a signed-in user. Attaching analytics to it
    // would count every voter as signed in and flatten the sign-up funnel.
    if (session && !session.user.is_anonymous) {
      identifiedAs.current = session.user.id;
      identifyUser(session.user.id, { auth_provider: session.user.app_metadata?.provider });
    } else if (identifiedAs.current) {
      identifiedAs.current = null;
      resetAnalytics();
      signedInFor.current = null; // Let a later sign-in count as a fresh one.
    }
    // is_anonymous is a dependency because the email upgrade keeps the user id
    // and only flips that flag.
  }, [session?.user.id, session?.user.is_anonymous]);

  // This is the sign-in step of the funnel. SIGNED_IN fires on a real sign-in,
  // meaning an email code or a return from OAuth. A returning user's restored
  // session arrives as INITIAL_SESSION instead, so it does not count. The
  // per-user guard drops the duplicate SIGNED_IN that supabase-js emits when the
  // tab regains focus, so each sign-in is counted exactly once.
  const wasAnonymous = useRef(false);
  useEffect(() => {
    const anonymous = !!session?.user.is_anonymous;
    // The silent anonymous sign-in also arrives as SIGNED_IN, and it is not
    // the funnel's sign-in step. The email upgrade of an anonymous account
    // arrives as USER_UPDATED on the same user id instead, so that
    // anonymous-to-permanent flip counts as the sign-in.
    const signedIn = authEvent === "SIGNED_IN" || (authEvent === "USER_UPDATED" && wasAnonymous.current);
    if (signedIn && session && !anonymous && signedInFor.current !== session.user.id) {
      signedInFor.current = session.user.id;
      track("signed_in", { provider: session.user.app_metadata?.provider });
    }
    wasAnonymous.current = anonymous;
  }, [authEvent, session?.user.id, session?.user.is_anonymous]);

  // Every note gets its own card, whether the AI wrote it, a user wrote it, or it
  // improves another note. The feed ranking below treats all three the same. The
  // only thing tying an improvement to its original is a jump-link, and
  // improvementsByOriginal is the reverse index of improved_from_note_id that
  // the jump-link is built from.
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

  // Maps a claim id to that claim's note-not-needed entries, oldest first. They
  // are ordered by age and not by votes, so an entry never jumps position while
  // the reader is looking at it. The same list renders under every note card on
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

  // The project we open on is the one named by the ?project= slug in the URL. If
  // there is no such slug, we take the first project in sort order that actually
  // has content, and asking which projects have content is the only reason the
  // page ever looks past the project it is showing.
  useEffect(() => {
    if (selectedId || projects.length === 0) return;
    const fromUrl = projects.find((p) => p.slug === readRoute().project);
    if (fromUrl) {
      setSelectedId(fromUrl.id);
      return;
    }
    let cancelled = false;
    fetchProjectIdsWithItems().then((withItems) => {
      if (cancelled) return;
      setSelectedId(projects.find((p) => withItems.has(p.id))?.id ?? projects[0]!.id);
    });
    return () => { cancelled = true; };
  }, [projects, selectedId]);

  // Selecting a project updates the URL. Back and Forward then restore the
  // selection. Each capture happens after the pushState so that the event
  // carries the new URL. Routing lives entirely in query parameters and only
  // the initial load is captured automatically, so these manual captures are
  // the only way navigation inside the app gets counted.
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

  // When the URL carries a shared ?note= link, scroll to that note once its card
  // has rendered. We scroll again a few times over the next two seconds, because
  // the YouTube iframes load late and shift the layout underneath it.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !loaded) return;
    const { note } = readRoute();
    if (!note) {
      scrolledRef.current = true;
      return;
    }
    if (!document.getElementById(`note-${note}`)) return; // Wait for its card.
    scrolledRef.current = true;
    for (const ms of [0, 400, 1000, 1800]) {
      setTimeout(() => document.getElementById(`note-${note}`)?.scrollIntoView({ block: "start" }), ms);
    }
  }, [loaded, notes, selectedId]);

  // Casts the vote and mints its donation. The outcome-contingent pair is
  // computed from the tally as it stood before this vote. It is frozen at that
  // moment and stored against the vote row. The function returns the minted
  // donation, and returns null in two cases. Retracting a vote returns null,
  // and the database cascade removes the donation with it. A signed-out visitor
  // returns null, since no vote is cast at all. A vote on your own note mints
  // like any other vote.
  const handleVote = async (note: NoteRow, vote: Vote): Promise<MintedDonation | null> => {
    // A reader with no session gets an invisible anonymous account on the
    // spot, so the vote just happens. Only when even that fails does the
    // sign-in form appear.
    const user = session?.user ?? (await ensureUser());
    if (!user) {
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
    const voteId = await castVote(note.id, user.id, vote, "web");
    if (!voteId) return null;
    const pair = donationPair(priorTally(note, current), vote);
    // The donation goes to the charity remembered on the account. The donation
    // box lets the voter redirect it afterwards.
    const charity = preferredCharity(user);
    // A backend without migration 061 rejects the pair of amount columns. We
    // keep the vote in that case. We just do not promise the user a donation the
    // ledger never recorded.
    const { error } = await saveDonation(voteId, charity, pair);
    return error ? null : { voteId, charity, pair };
  };

  const handleNnnVote = async (entry: NnnRow, vote: Vote) => {
    const user = session?.user ?? (await ensureUser());
    if (!user) {
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
      await castNnnVote(entry.id, user.id, vote);
    }
  };

  // A database trigger casts the author's own helpful vote on a note or an entry
  // the moment they post it. We mirror that into the local vote maps, so the
  // rating pills light up without refetching anything.
  const nnnApi = {
    myVotes: myNnnVotes,
    onVote: handleNnnVote,
    onAuthored: (entryId: string) =>
      setMyNnnVotes((m) => new Map(m).set(entryId, 1)),
  };
  const noteAuthored = (noteId: string) => setMyVotes((m) => new Map(m).set(noteId, 1));

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  // The project's items that actually have notes, newest first. This list feeds
  // both the chip row and the note feed.
  const projectItems = [...items.values()]
    .filter((i) => (notesByItem.get(i.id)?.length ?? 0) > 0)
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at));
  const itemNoteCounts = new Map(projectItems.map((i) => [i.id, notesByItem.get(i.id)!.length]));
  // Ignore an ?item= parameter that is stale or belongs to another project.
  // Showing the whole project is better than showing an empty feed.
  const activeItem = projectItems.some((i) => i.id === itemFilter) ? itemFilter : null;
  // Keeps an improvement chain grouped behind the note it descends from when the
  // feed is put in content order. Notes on the same claim all share one
  // start_seconds value, so that alone cannot order them. We break the tie on the
  // age of the chain's root note, then put originals before improvements, then
  // fall back to the note's own age. The result is deterministic, which is what
  // contentIdx relies on.
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
  // A project renders as a plain list of notes with no per-item headers. The
  // newest item comes first, and inside an item the notes follow the content in
  // clip-timestamp order. The item chips narrow this down to a single item, and
  // the ranking below applies to that subset unchanged.
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
  // Ranking is frozen for the whole page load. A note is ranked by the vote tally
  // it carried when it first appeared, so no card ever moves underneath the
  // reader. That matters most for the card they have just voted on. The card
  // itself stays live, because its badge, its counts and its donation all read
  // the real tally. Reloading the page drops the freeze and the feed re-sorts.
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
  // Computing p evaluates a continued fraction, so each note's ranking inputs are
  // derived once here instead of inside the comparators below. A comparator would
  // recompute them O(n log n) times on every render.
  //
  // One predicate decides the badge, the feed section and the donation payout.
  // That is noteStatus in everything-shared/noteScore.ts, the p-based rating
  // rule.
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
  // apply, whatever its rating. So it drops below everything else instead of
  // sitting among the notes about the text as it reads now. This beats the
  // rating status whenever the two disagree.
  const staleSource = (n: NoteRow) => n.claim?.updated_quote != null;
  const current = orderedNotes.filter((n) => !staleSource(n));
  const needRatings = current.filter((n) => rankOf(n).status === "needs_ratings");
  const helpfulNotes = current.filter((n) => rankOf(n).status === "helpful");
  const unhelpfulNotes = current.filter((n) => rankOf(n).status === "not_helpful");
  const staleSourceNotes = orderedNotes.filter(staleSource);
  // Every group is ordered by p, the latent-quality model's estimate that the
  // note ends up rated helpful. See everything-shared/noteBelief.ts. The whole
  // feed therefore reads as one gradient, from the most uncertain notes at the
  // top down to the most settled ones.
  // The group needing ratings leads with the note a single Helpful vote would
  // carry furthest, because that note is the closest to resolving. Attention then
  // lands where it settles something. Two notes with equal p have identical
  // tallies, and the older of them goes first because it has waited longest.
  needRatings.sort(
    (a, b) =>
      rankOf(b).pAfterOneHelpful - rankOf(a).pAfterOneHelpful ||
      a.created_at.localeCompare(b.created_at) ||
      contentIdx.get(a.id)! - contentIdx.get(b.id)!,
  );
  // The notes rated helpful are ordered by ascending p, so the most confidently
  // helpful one sits lowest.
  helpfulNotes.sort(
    (a, b) =>
      rankOf(a).p - rankOf(b).p ||
      rankOf(a).votes - rankOf(b).votes ||
      contentIdx.get(a.id)! - contentIdx.get(b.id)!,
  );
  // The notes rated unhelpful are ordered by descending p, so the least helpful
  // one sinks lowest. That mirrors the helpful group and continues the same
  // gradient.
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

      {/* min-w-0 is what keeps the feed inside the window. A flex item starts with
        * min-width auto, which means it refuses to shrink below its own content.
        * This main element also sets w-full, so that floor is the full width of
        * the window, and the sidebar's 256px then push the feed off the right
        * edge. Setting the floor to zero lets the feed take the space that is
        * actually left beside the sidebar. */}
      <main className="flex-1 min-w-0 max-w-3xl md:max-w-[96rem] mx-auto px-4 md:px-8 py-8 w-full">
        {/* The title and the two actions share one row on a wide window. On a
          * phone they do not fit next to each other, so the row is allowed to
          * wrap and the title is allowed to break rather than push the actions
          * off screen. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-6">
          <h2 className="text-2xl font-extrabold min-w-0 break-words">
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
              className={`text-sm font-medium shrink-0 ${LINK}`}
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
        {view === "notes" && !loaded && !feedFailed && !projectsFailed && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}
        {view === "notes" && (feedFailed || projectsFailed) && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              These notes could not be loaded. The connection to our server failed.
            </p>
            <button
              onClick={() => (projectsFailed ? window.location.reload() : retryFeed())}
              className={BUTTON}
            >
              Try again
            </button>
          </div>
        )}
        {view === "notes" && loaded && !feedFailed && orderedNotes.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No notes yet for this project.</p>
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

      <SystemTheme />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <WriteNoteModal open={writeOpen} onClose={() => setWriteOpen(false)} />
    </div>
  );
}
