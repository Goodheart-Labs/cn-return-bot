import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ensureWebItem } from "@cn/core/items";
import { deleteNnn, postNnn } from "@cn/core/noteNotNeeded";
import { deleteNote } from "@cn/core/notes";
import { postClaimWithNote, postImprovement, type PostedNote } from "@cn/core/postNote";
import { parkMintedDonation } from "../donations/mintedDonations";
import { queryKeys } from "../query/queryKeys";

/** Refreshes everything a posted or deleted note changes: the notes on screen,
 *  and the reader's own votes, because a database trigger casts an author's
 *  helpful vote on their own new note or entry. */
function useRefreshAfterWrite() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.noteSets }),
      client.invalidateQueries({ queryKey: queryKeys.ownVotes }),
    ]);
}

/** A freshly posted note brings the donation its automatic Helpful vote
 *  minted. It is parked for the note's card, which shows the notice when it
 *  first renders. */
function useAfterPostingNote() {
  const refresh = useRefreshAfterWrite();
  return (posted: PostedNote) => {
    if (posted.donation) parkMintedDonation(posted.noteId, posted.donation);
    return refresh();
  };
}

/** Posts an improved version of a note as the reader's own draft note. */
export function usePostImprovement() {
  return useMutation({ mutationFn: postImprovement, onSuccess: useAfterPostingNote() });
}

/** Posts a brand-new note on a passage the reader selected. A page we have
 *  never ingested has no item row yet, so `item` may be missing; the row is
 *  then created from `page` only now, when the note is actually posted, and
 *  closing the composer leaves no orphan item behind. `page.creatorFeedUrl`
 *  files that new item under the page's creator instead of "Around the web".
 *  It is the still-running lookup of that creator, and posting waits for it. */
export function usePostClaimWithNote() {
  return useMutation({
    mutationFn: async ({ item, page, ...rest }: Omit<Parameters<typeof postClaimWithNote>[0], "itemId" | "itemUrl"> & {
      item: { id: string; url: string } | null;
      page: { url: string; title: string; creatorFeedUrl?: Promise<string | null> };
    }) => {
      const itemId = item?.id ?? (await ensureWebItem({ ...page, creatorFeedUrl: await page.creatorFeedUrl }));
      return postClaimWithNote({ ...rest, itemId, itemUrl: item?.url ?? page.url });
    },
    onSuccess: useAfterPostingNote(),
  });
}

/** Posts an argument that a claim needs no note. */
export function usePostNnn() {
  return useMutation({ mutationFn: postNnn, onSuccess: useRefreshAfterWrite() });
}

/** Deletes one of the reader's own draft notes. */
export function useDeleteNote() {
  return useMutation({
    mutationFn: deleteNote,
    onSuccess: useRefreshAfterWrite(),
    onError: (err) => console.error("[common-notes] note delete failed:", err),
  });
}

/** Deletes one of the reader's own note-not-needed entries. */
export function useDeleteNnn() {
  return useMutation({
    mutationFn: deleteNnn,
    onSuccess: useRefreshAfterWrite(),
    onError: (err) => console.error("[common-notes] entry delete failed:", err),
  });
}
