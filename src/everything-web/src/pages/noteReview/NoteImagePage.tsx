import { useQuery } from "@tanstack/react-query";
import { fetchNotesByIds } from "@cn/core/notes";
import { noteStatus } from "@cn/core/noteScore";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { queryKeys } from "@cn/features/query/queryKeys";
import { ClaimCard } from "../../components/ClaimCard";

/** The width of the picture, in CSS pixels. The server takes it at twice that
 *  for sharp text. */
const IMAGE_WIDTH_PX = 560;

/** One note's card and nothing else, for the local posting tool's server to
 *  take a picture of: the passage in its post and the note, without the
 *  voting pills and the action row. The server waits for the element with
 *  `data-note-image`. */
export function NoteImagePage({ noteId }: { noteId: string }) {
  const note = useQuery({ queryKey: queryKeys.noteImage(noteId), queryFn: async () => (await fetchNotesByIds([noteId]))[0] ?? null });
  if (note.isError) return <p className="p-8 text-sm text-negative">{note.error.message}</p>;
  if (note.data === null) return <p className="p-8 text-sm text-fg-muted">There is no note {noteId}.</p>;
  if (!note.data) return null;
  return (
    <main className="p-6">
      <div data-note-image style={{ width: IMAGE_WIDTH_PX }}>
        <ClaimCard claim={note.data.claim} paragraph={null}>
          <NoteBox note={note.data} status={noteStatus(note.data)} />
        </ClaimCard>
      </div>
    </main>
  );
}
