import { useEffect, useMemo, useState } from "react";
import { useLiveData } from "./lib/useLiveData";
import { useSession, signOut } from "./lib/auth";
import { castVote, clearVote, fetchMyVotes, type Vote } from "./lib/votes";
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

  // Default to the first project (by sort order) that actually has content.
  useEffect(() => {
    if (selectedId || projects.length === 0) return;
    const withItems = new Set([...items.values()].map((i) => i.project_id));
    setSelectedId(projects.find((p) => withItems.has(p.id))?.id ?? projects[0]!.id);
  }, [projects, items, selectedId]);

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
        onSelect={setSelectedId}
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
