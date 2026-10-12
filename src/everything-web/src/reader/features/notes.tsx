import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNnnForClaims } from "@cn/core/noteNotNeeded";
import { fetchNotesForItem } from "@cn/core/notes";
import { subscribeToItemProgress } from "@cn/core/requestStatus";
import { statusLabel } from "@cn/features/notes/NoteBox";
import { noteStatus } from "@cn/core/noteScore";
import { Note } from "@cn/features/notes/Note";
import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { Card } from "@cn/ui/Card";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import { useReader, type ReaderModule } from "../context";
import { ClosedEntry, EntryBar } from "../EntryBar";

/** The article's notes and note-not-needed entries, refreshed whenever the
 *  pipeline or a reader changes them. */
export function useReaderNoteSet(itemId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.itemNoteSet(itemId ?? ""),
    enabled: !!itemId,
    queryFn: async () => {
      const notes = await fetchNotesForItem(itemId!);
      const entries = await fetchNnnForClaims([...new Set(notes.map((note) => note.claim_id))]);
      return noteSetOf(notes, entries);
    },
  });
  const { refetch } = query;
  useEffect(() => {
    if (!itemId) return;
    return subscribeToItemProgress(itemId, () => { void refetch(); }, () => { void refetch(); });
  }, [itemId, refetch]);
  return query;
}

export const noteCardId = (scope: string, noteId: string) => `${scope}-note-${noteId}`;

/** A note's share link opens this same page, scrolled to the note. */
function shareUrl(noteId: string, scope: string): string {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("passage");
  url.searchParams.set("note", noteId);
  url.searchParams.set("edition", scope);
  return url.href;
}

/** One note in the margin. It leaves out the claim's quote, because the card
 *  sits right beside the passage it quotes. A claim that rests on an image
 *  still shows the image. */
function NoteCard({ note, shareUrl, nnnEntries, topBar }: {
  note: NoteRow;
  shareUrl: string;
  nnnEntries: NnnRow[];
  /** A bar above the note, such as the "3 of 8 ›" button. */
  topBar: ReactNode;
}) {
  return (
    <Card className="min-w-0 p-4">
      <div className="-mt-1 mb-3 flex items-center">{topBar}</div>
      {note.claim.image_urls.length > 0 && <div className="mb-3 flex flex-wrap gap-2">
        {note.claim.image_urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Claim source" loading="lazy" className="max-h-48 max-w-full rounded-control" /></a>)}
      </div>}
      <Note note={note} shareUrl={shareUrl} compact />
      <NoteNotNeeded entries={nnnEntries} />
    </Card>
  );
}

function NoteEntries({ blockId }: { blockId: string }) {
  const { features, notesByBlock, nnnEntries, scope, isCollapsed } = useReader();
  if (!features.has("notes")) return null;
  return <>{(notesByBlock.get(blockId) ?? []).map((note) => {
    const id = noteCardId(scope, note.id);
    if (isCollapsed(id)) return <ClosedEntry key={note.id} elementId={id} kind="Note" detail={statusLabel(noteStatus(note))} />;
    return <div key={note.id} id={id} className="reader-entry">
      <NoteCard topBar={<EntryBar elementId={id} kind="note" />} note={note} shareUrl={shareUrl(note.id, scope)} nnnEntries={nnnEntries.filter((entry) => entry.claim_id === note.claim_id)} />
    </div>;
  })}</>;
}

/** Notes in the margin: AI notes and readers' notes beside their passage. The
 *  shell loads the notes, because their quotes also mark the text. */
export const notesModule: ReaderModule = {
  name: "notes",
  marginCount: (api, blockId) => (api.features.has("notes") ? api.notesByBlock.get(blockId)?.length ?? 0 : 0),
  MarginEntries: NoteEntries,
};
