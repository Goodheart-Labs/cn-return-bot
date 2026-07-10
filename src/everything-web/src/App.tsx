import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveData } from "./lib/useLiveData";
import { useSession, signOut } from "./lib/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "./lib/votes";
import { readRoute, pushProject } from "./lib/routing";
import { Sidebar } from "./components/Sidebar";
import { LoginModal } from "./components/LoginModal";
import { NoteCard } from "./components/NoteCard";
import type { NoteRow, SuggestionRow } from "./lib/types";

export function App() {
  const { projects, items, notes, suggestions, loaded } = useLiveData();
  const { session } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (session) fetchMyVotes().then(setMyVotes);
    else setMyVotes(new Map());
  }, [session?.user.id]);

  const notesByItem = useMemo(() => {
    const map = new Map<string, NoteRow[]>();
    for (const note of notes.values()) {
      const itemId = note.claim?.item_id;
      if (!itemId) continue;
      const list = map.get(itemId) ?? [];
      list.push(note);
      map.set(itemId, list);
    }
    return map;
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

  const handleVote = async (note: NoteRow, vote: Vote) => {
    if (!session) {
      setLoginOpen(true);
      return;
    }
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
  const projectNotes = [...items.values()]
    .filter((i) => i.project_id === selectedId)
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
    .flatMap((item) =>
      (notesByItem.get(item.id) ?? []).sort(
        (a, b) => (a.claim?.start_seconds ?? 0) - (b.claim?.start_seconds ?? 0),
      ),
    );

  return (
    <div className="md:flex">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
        session={session}
        onSignIn={() => setLoginOpen(true)}
        onSignOut={() => signOut()}
      />

      <main className="flex-1 max-w-3xl mx-auto px-4 md:px-8 py-8 w-full">
        {selected && <h2 className="text-2xl font-bold mb-6">{selected.name}</h2>}
        {!loaded && <p className="text-gray-400">Loading…</p>}
        {loaded && projectNotes.length === 0 && (
          <p className="text-gray-400">No notes yet for this project.</p>
        )}
        <div className="space-y-4">
          {projectNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              projectSlug={selected?.slug ?? ""}
              suggestions={suggestionsByNote.get(note.id) ?? []}
              myVote={myVotes.get(note.id)}
              onVote={handleVote}
              session={session}
              onNeedLogin={() => setLoginOpen(true)}
            />
          ))}
        </div>
      </main>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
