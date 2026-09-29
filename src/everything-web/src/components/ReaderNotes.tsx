import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNotesForItem } from "@cn/core/notes";
import { fetchNnnForClaims } from "@cn/core/noteNotNeeded";
import type { NoteRow } from "@cn/core/types";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { NoteCard } from "@cn/features/notes/NoteCard";
import { noteSetOf, type NoteSet } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import { LoginModal } from "./LoginModal";

const ReaderNotesContext = createContext<NoteSet>(noteSetOf([], []));

export function useReaderNoteSet(itemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.itemNoteSet(itemId ?? ""),
    enabled: !!itemId,
    queryFn: async () => {
      const notes = await fetchNotesForItem(itemId!);
      const entries = await fetchNnnForClaims([...new Set(notes.map((note) => note.claim_id))]);
      return noteSetOf(notes, entries);
    },
  });
}

export function ReaderNotesProvider({ noteSet, children }: { noteSet?: NoteSet; children: ReactNode }) {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <LoginPromptProvider value={() => setLoginOpen(true)}>
      <ReaderNotesContext.Provider value={noteSet ?? noteSetOf([], [])}>
        {children}
      </ReaderNotesContext.Provider>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </LoginPromptProvider>
  );
}

export function ReaderNoteCard({ note, scope }: { note: NoteRow; scope: string }) {
  const { nnn } = useContext(ReaderNotesContext);
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("passage");
  url.searchParams.set("note", note.id);
  url.searchParams.set("edition", scope);
  return (
    <div id={`${scope}-note-${note.id}`}>
      <NoteCard compact note={note} shareUrl={url.href} nnnEntries={[...nnn.values()].filter((entry) => entry.claim_id === note.claim_id)} />
    </div>
  );
}
