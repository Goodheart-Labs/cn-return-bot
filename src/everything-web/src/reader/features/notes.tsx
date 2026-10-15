import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNnnForClaims } from "@cn/core/noteNotNeeded";
import { fetchNotesForItem } from "@cn/core/notes";
import { subscribeToItemProgress } from "@cn/core/requestStatus";
import { statusColorClass, statusLabel } from "@cn/features/notes/NoteBox";
import { noteStatus, type NoteStatus } from "@cn/core/noteScore";
import { Note } from "@cn/features/notes/Note";
import { NoteNotNeeded } from "@cn/features/notes/NoteNotNeeded";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { Card } from "@cn/ui/Card";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import { useReader, type ReaderModule } from "../context";
import { EntryBar } from "../EntryBar";
import { MarginSlot, SLOT_PRIORITY } from "../MarginSlot";

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
/** The margin slot of a group of notes on the same words, named after its first note. */
export const noteSlotKey = (scope: string, firstNoteId: string) => `${scope}-notes-${firstNoteId}`;

export const noteQuoteText = (note: NoteRow): string => (note.claim.updated_quote ?? note.claim.context_quote ?? "").trim();

/** Notes on exactly the same words share one slot in the margin, with one dot
 *  and one card. A note without a quote stays on its own. */
export function groupNotesByQuote(notes: readonly NoteRow[]): NoteRow[][] {
  const groups = new Map<string, NoteRow[]>();
  for (const note of notes) {
    const key = noteQuoteText(note) || note.id;
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  return [...groups.values()];
}

const STATUS_ORDER: readonly NoteStatus[] = ["helpful", "needs_ratings", "not_helpful"];

function bestStatus(notes: readonly NoteRow[]): NoteStatus {
  const statuses = new Set(notes.map(noteStatus));
  return STATUS_ORDER.find((status) => statuses.has(status))!;
}

function groupPriority(notes: readonly NoteRow[], status: NoteStatus): number {
  if (status === "helpful") return SLOT_PRIORITY.helpful;
  if (status === "not_helpful") return SLOT_PRIORITY.notHelpful;
  return notes.some((note) => !note.author_id) ? SLOT_PRIORITY.aiNote : SLOT_PRIORITY.readerNote;
}

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
  const { features, notesByBlock, nnnEntries, scope } = useReader();
  if (!features.has("notes")) return null;
  return <>{groupNotesByQuote(notesByBlock.get(blockId) ?? []).map((group) => {
    const status = bestStatus(group);
    const label = `${group.length > 1 ? `${group.length} notes` : "Note"} · ${statusLabel(status)}`;
    return <MarginSlot key={group[0]!.id} slotKey={noteSlotKey(scope, group[0]!.id)} colorClass={statusColorClass(status)} priority={groupPriority(group, status)} label={label}>
      <div className="reader-slot-stack">
        {group.map((note, index) => {
          const id = noteCardId(scope, note.id);
          return <div key={note.id} id={id} className="reader-entry">
            <NoteCard topBar={<EntryBar elementId={id} kind={group.length > 1 ? "notes" : "note"} closable={index === 0} />} note={note} shareUrl={shareUrl(note.id, scope)} nnnEntries={nnnEntries.filter((entry) => entry.claim_id === note.claim_id)} />
          </div>;
        })}
      </div>
    </MarginSlot>;
  })}</>;
}

/** Notes in the margin: AI notes and readers' notes beside their passage. The
 *  shell loads the notes, because their quotes also mark the text. */
export const notesModule: ReaderModule = {
  name: "notes",
  marginCount: (api, blockId) => (api.features.has("notes") ? api.notesByBlock.get(blockId)?.length ?? 0 : 0),
  MarginEntries: NoteEntries,
};
