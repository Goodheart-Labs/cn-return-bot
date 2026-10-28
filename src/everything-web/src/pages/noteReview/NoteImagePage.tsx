import { useQuery } from "@tanstack/react-query";
import { fetchFeedItem } from "@cn/core/items";
import { fetchNotesByIds } from "@cn/core/notes";
import { noteStatus } from "@cn/core/noteScore";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { VoteRatings } from "@cn/features/notes/VoteRatings";
import { queryKeys } from "@cn/features/query/queryKeys";
import { ClaimCard } from "../../components/ClaimCard";

/** The width of the picture in CSS pixels, which is the width of a card in
 *  the website's feed. The server takes it at twice that for sharp text. */
const IMAGE_WIDTH_PX = 640;

async function fetchNoteWithPost(noteId: string) {
  const note = (await fetchNotesByIds([noteId]))[0];
  if (!note) return null;
  return { note, post: (await fetchFeedItem(note.claim.item_id)) ?? undefined };
}

/** One note's card as the website's feed shows it, for the local posting
 *  tool's server to take a picture of: the post's title, the passage, the note
 *  with its whole source links, and the rating pills with their counts. The
 *  surrounding paragraph and the action row are left out. The server waits for
 *  the element with `data-note-image`. */
export function NoteImagePage({ noteId }: { noteId: string }) {
  const card = useQuery({ queryKey: queryKeys.noteImage(noteId), queryFn: () => fetchNoteWithPost(noteId) });
  if (card.isError) return <p className="p-8 text-sm text-negative">{card.error.message}</p>;
  if (card.data === null) return <p className="p-8 text-sm text-fg-muted">There is no note {noteId}.</p>;
  if (!card.data) return null;
  const { note, post } = card.data;
  return (
    <main className="p-6">
      <div data-note-image style={{ width: IMAGE_WIDTH_PX }}>
        <ClaimCard claim={note.claim} paragraph={null} post={post}>
          <NoteBox note={note} status={noteStatus(note)}>
            <VoteRatings helpful={note.helpful_count} somewhatHelpful={note.somewhat_helpful_count} notHelpful={note.not_helpful_count} showCounts onVote={() => {}} />
          </NoteBox>
        </ClaimCard>
      </div>
    </main>
  );
}
