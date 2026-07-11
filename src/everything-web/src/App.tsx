import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useLiveData } from "./lib/useLiveData";
import { useSession, signOut } from "./lib/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "./lib/votes";
import { readRoute, pushProject } from "./lib/routing";
import { Sidebar } from "./components/Sidebar";

function AuthCorner({ session, onSignIn, onSignOut }: {
  session: Session | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (!session) {
    return (
      <button onClick={onSignIn} className="text-sm text-blue-600 hover:underline shrink-0">
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
import type { NoteRow, SuggestionRow } from "./lib/types";

export function App() {
  const { projects, items, notes, suggestions, loaded, injectNote } = useLiveData();
  const { session } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [loginOpen, setLoginOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  // Localhost test mode: write-note works signed-out; drafts stay client-side.
  const isLocalhost = window.location.hostname === "localhost";
  // After a vote, hold the note's list position briefly (misclick grace) —
  // maps note id → its fold side at vote time. Cleared by a timer, then the
  // live counts decide again.
  const RESORT_GRACE_MS = 6000;
  const [voteHolds, setVoteHolds] = useState<Map<string, boolean>>(new Map());
  const holdTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (session) fetchMyVotes().then(setMyVotes);
    else setMyVotes(new Map());
  }, [session?.user.id]);

  // One card per claim: the AI note is primary when it exists, else the
  // earliest user draft (user-anchored claims get their own card); the rest
  // of the claim's notes hang underneath.
  const { notesByItem, draftsByClaim } = useMemo(() => {
    const byClaim = new Map<string, NoteRow[]>();
    for (const note of notes.values()) {
      const list = byClaim.get(note.claim_id) ?? [];
      list.push(note);
      byClaim.set(note.claim_id, list);
    }
    const byItem = new Map<string, NoteRow[]>();
    const drafts = new Map<string, NoteRow[]>();
    for (const list of byClaim.values()) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const primary = list.find((n) => !n.author_id) ?? list[0]!;
      drafts.set(primary.claim_id, list.filter((n) => n !== primary));
      const itemId = primary.claim?.item_id;
      if (!itemId) continue;
      const cards = byItem.get(itemId) ?? [];
      cards.push(primary);
      byItem.set(itemId, cards);
    }
    return { notesByItem: byItem, draftsByClaim: drafts };
  }, [notes]);

  const suggestionsByNote = useMemo(() => {
    const map = new Map<string, SuggestionRow[]>();
    for (const s of suggestions.values()) {
      const list = map.get(s.note_id) ?? [];
      list.push(s);
      map.set(s.note_id, list);
    }
    return map;
  }, [suggestions]);

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
    const slug = projects.find((p) => p.id === id)?.slug;
    if (slug) pushProject(slug);
  };
  useEffect(() => {
    const onPop = () => {
      const p = projects.find((pp) => pp.slug === readRoute().project);
      if (p) setSelectedId(p.id);
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
    const wasUnderwater = note.not_helpful_count > note.helpful_count + note.somewhat_helpful_count;
    setVoteHolds((m) => new Map(m).set(note.id, wasUnderwater));
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

  const handleVote = async (note: NoteRow, vote: Vote) => {
    if (!session) {
      setLoginOpen(true);
      return;
    }
    holdPosition(note);
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
  };

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  // A project is just its notes — no per-item headers. Newest content first,
  // then in content order (clip timestamp) within an item.
  const orderedNotes = [...items.values()]
    .filter((i) => i.project_id === selectedId)
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
    .flatMap((item) =>
      (notesByItem.get(item.id) ?? []).sort(
        (a, b) => (a.claim?.start_seconds ?? 0) - (b.claim?.start_seconds ?? 0),
      ),
    );
  // Nathan's ranking spec (prep doc, #7): a note "locks in" as a real note at
  // >=5 ratings with net-positive score; under that it's a draft. Feed order:
  // top 3 slots go to the best real notes, then real/draft interleave 1:1,
  // then the draft long tail. Net-negative notes sink below a labeled divider.
  const weight = (n: NoteRow) => n.helpful_count + 0.5 * n.somewhat_helpful_count;
  const totalVotes = (n: NoteRow) => n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count;
  const score = (n: NoteRow) => (totalVotes(n) === 0 ? 0 : weight(n) / totalVotes(n));
  const isLocked = (n: NoteRow) => totalVotes(n) >= 5 && weight(n) > n.not_helpful_count;
  const isUnderwater = (n: NoteRow) =>
    voteHolds.has(n.id)
      ? voteHolds.get(n.id)!
      : n.not_helpful_count > n.helpful_count + n.somewhat_helpful_count;

  // Really unhelpful = enough ratings to be confident (>=5) and a weighted
  // score under 0.4 — those collapse into a drawer at the bottom; mildly
  // negative notes stay visible below the dotted line.
  const isBuried = (n: NoteRow) => totalVotes(n) >= 5 && score(n) < 0.4;
  const aboveWater = orderedNotes.filter((n) => !isUnderwater(n));
  const underwaterNotes = orderedNotes.filter((n) => isUnderwater(n) && !isBuried(n));
  const buriedNotes = orderedNotes.filter((n) => isUnderwater(n) && isBuried(n));
  // Rank by score, then vote volume, then keep content order stable.
  const contentIdx = new Map(orderedNotes.map((n, i) => [n.id, i]));
  const ranked = [...aboveWater].sort(
    (a, b) => score(b) - score(a) || totalVotes(b) - totalVotes(a) || contentIdx.get(a.id)! - contentIdx.get(b.id)!,
  );
  const realNotes = ranked.filter(isLocked);
  const draftFeed = ranked.filter((n) => !isLocked(n));
  const projectNotes: NoteRow[] = [...realNotes.slice(0, 3)];
  const restReal = realNotes.slice(3);
  for (let i = 0; restReal.length > i || draftFeed.length > i * 0; i++) {
    if (i >= restReal.length && i >= draftFeed.length) break;
    if (i < restReal.length) projectNotes.push(restReal[i]!);
    if (i < draftFeed.length) projectNotes.push(draftFeed[i]!);
  }

  return (
    <div className="md:flex">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
      />

      <main className="flex-1 max-w-3xl md:max-w-[96rem] mx-auto px-4 md:px-8 py-8 w-full">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-2xl font-bold">{selected?.name ?? ""}</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={() => (session || isLocalhost ? setWriteOpen(true) : setLoginOpen(true))}
              className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 shrink-0"
            >
              Write a note
            </button>
            <AuthCorner session={session} onSignIn={() => setLoginOpen(true)} onSignOut={() => signOut()} />
          </div>
        </div>
        {!loaded && <p className="text-gray-400">Loading…</p>}
        {loaded && projectNotes.length === 0 && (
          <p className="text-gray-400">No notes yet for this project.</p>
        )}
        <div className="space-y-4">
          {projectNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              locked={isLocked(note)}
              draftNotes={draftsByClaim.get(note.claim_id) ?? []}
              projectSlug={selected?.slug ?? ""}
              suggestions={suggestionsByNote.get(note.id) ?? []}
              myVotes={myVotes}
              voteHolds={voteHolds}
              onVote={handleVote}
              session={session}
              onNeedLogin={() => setLoginOpen(true)}
            />
          ))}
          {underwaterNotes.length > 0 && (
            <>
              <div className="flex items-center gap-3 pt-4 max-w-xl mx-auto w-full xl:max-w-none" role="separator">
                <span className="flex-1 border-t-2 border-dotted border-gray-300" />
                <span className="text-xs text-gray-400">Notes with more negative votes than positive</span>
                <span className="flex-1 border-t-2 border-dotted border-gray-300" />
              </div>
              {underwaterNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  locked={isLocked(note)}
                  draftNotes={draftsByClaim.get(note.claim_id) ?? []}
                  projectSlug={selected?.slug ?? ""}
                  suggestions={suggestionsByNote.get(note.id) ?? []}
                  myVotes={myVotes}
                  voteHolds={voteHolds}
                  onVote={handleVote}
                  session={session}
                  onNeedLogin={() => setLoginOpen(true)}
                />
              ))}
            </>
          )}
          {buriedNotes.length > 0 && (
            <details className="max-w-xl mx-auto w-full xl:max-w-none pt-2">
              <summary className="text-xs text-gray-400 cursor-pointer select-none text-center">
                {buriedNotes.length} {buriedNotes.length === 1 ? "note" : "notes"} rated unhelpful — show
              </summary>
              <div className="space-y-4 mt-4">
                {buriedNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    locked={isLocked(note)}
                    draftNotes={draftsByClaim.get(note.claim_id) ?? []}
                    projectSlug={selected?.slug ?? ""}
                    suggestions={suggestionsByNote.get(note.id) ?? []}
                    myVotes={myVotes}
                    voteHolds={voteHolds}
                    onVote={handleVote}
                    session={session}
                    onNeedLogin={() => setLoginOpen(true)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      </main>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {(session || isLocalhost) && (
        <WriteNoteModal
          open={writeOpen}
          onClose={() => setWriteOpen(false)}
          projectId={selectedId}
          session={session}
          onLocalDraft={(item, anchorText, noteText) => {
            const claimId = `local-${crypto.randomUUID()}`;
            injectNote({
                id: `local-${crypto.randomUUID()}`,
                claim_id: claimId,
                note: noteText,
                sources: [],
                helpful_count: 0,
                somewhat_helpful_count: 0,
                not_helpful_count: 0,
                author_id: "local-test",
                author_name: "you (local test — not saved)",
                status: "draft",
                created_at: new Date().toISOString(),
                claim: {
                  id: claimId,
                  item_id: item.id,
                  claim: anchorText.slice(0, 300),
                  context_quote: anchorText,
                  context_paragraph: null,
                  context_url: item.url,
                  start_seconds: null,
                  end_seconds: null,
                },
              });
          }}
        />
      )}
    </div>
  );
}
