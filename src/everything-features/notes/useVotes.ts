import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { track } from "@cn/core/analytics";
import { castVoteWithDonation, type MintedDonation } from "@cn/core/donations";
import { currentPlatform } from "@cn/core/extensionStorage";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes, fetchNnnEntry } from "@cn/core/noteNotNeeded";
import { fetchNote } from "@cn/core/notes";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { clearVote, fetchMyVotes, type Vote } from "@cn/core/votes";
import { useActingUser } from "../auth/useActingUser";
import { useSession } from "../auth/useSession";
import { queryKeys } from "../query/queryKeys";
import { updateNnnInNoteSets, updateNoteInNoteSets } from "./noteSet";

const NO_VOTES: ReadonlyMap<string, Vote> = new Map();

/** The signed-in reader's own votes on notes, keyed by note id. */
export function useMyVotes(): ReadonlyMap<string, Vote> {
  const userId = useSession().session?.user.id;
  return useQuery({ queryKey: queryKeys.myVotes(userId), queryFn: fetchMyVotes, enabled: !!userId }).data ?? NO_VOTES;
}

/** The signed-in reader's own votes on note-not-needed entries, keyed by entry
 *  id. */
export function useMyNnnVotes(): ReadonlyMap<string, Vote> {
  const userId = useSession().session?.user.id;
  return useQuery({ queryKey: queryKeys.myNnnVotes(userId), queryFn: fetchMyNnnVotes, enabled: !!userId }).data ?? NO_VOTES;
}

/** Writes one vote into the cached vote map, or removes it when `vote` is
 *  undefined. */
function setCachedVote(client: QueryClient, key: readonly unknown[], id: string, vote: Vote | undefined) {
  client.setQueryData<ReadonlyMap<string, Vote>>(key, (votes) => {
    const next = new Map(votes);
    if (vote === undefined) next.delete(id);
    else next.set(id, vote);
    return next;
  });
}

interface VoteVariables<T> {
  target: T;
  vote: Vote;
  user: User;
  previousVote: Vote | undefined;
}

/** Pressing the pill that is already lit retracts the vote. */
const isRetraction = <T,>({ vote, previousVote }: VoteVariables<T>) => vote === previousVote;

/** Returns the function that casts, changes or retracts a vote on a note. The
 *  pill lights up at once, and it goes dark again if saving fails. Once saved,
 *  the note is fetched again, because the counts are computed by database
 *  triggers, and every surface showing the note gets the new counts.
 *
 *  The function resolves to the donation the vote minted. It resolves to null
 *  when the vote was retracted, when it failed, and when the reader has to
 *  sign in first. */
export function useVoteOnNote(): (note: NoteRow, vote: Vote) => Promise<MintedDonation | null> {
  const client = useQueryClient();
  const actingUser = useActingUser();
  const { mutateAsync } = useMutation({
    mutationFn: async (v: VoteVariables<NoteRow>) =>
      isRetraction(v)
        ? (await clearVote(v.target.id), null)
        : castVoteWithDonation({ note: v.target, vote: v.vote, previousVote: v.previousVote, user: v.user, platform: currentPlatform() }),
    onMutate: (v) => setCachedVote(client, queryKeys.myVotes(v.user.id), v.target.id, isRetraction(v) ? undefined : v.vote),
    onError: (err, v) => {
      console.error("[common-notes] vote failed:", err);
      setCachedVote(client, queryKeys.myVotes(v.user.id), v.target.id, v.previousVote);
    },
    onSettled: async (_result, _error, v) => {
      const fresh = await fetchNote(v.target.id);
      if (fresh) updateNoteInNoteSets(client, fresh);
    },
  });
  return async (note, vote) => {
    const user = await actingUser().catch((err: unknown) => {
      console.error("[common-notes] vote failed:", err);
      return undefined;
    });
    if (user === undefined) return null;
    if (!user) {
      track("vote_gated_login", { note_id: note.id });
      return null;
    }
    const previousVote = client.getQueryData<ReadonlyMap<string, Vote>>(queryKeys.myVotes(user.id))?.get(note.id);
    return mutateAsync({ target: note, vote, user, previousVote }).catch(() => null);
  };
}

/** Returns the function that casts, changes or retracts a vote on a
 *  note-not-needed entry. It works like a note vote, except that entry votes
 *  never mint a donation. */
export function useVoteOnNnn(): (entry: NnnRow, vote: Vote) => Promise<void> {
  const client = useQueryClient();
  const actingUser = useActingUser();
  const { mutateAsync } = useMutation({
    mutationFn: (v: VoteVariables<NnnRow>) =>
      isRetraction(v) ? clearNnnVote(v.target.id) : castNnnVote(v.target.id, v.user.id, v.vote),
    onMutate: (v) => setCachedVote(client, queryKeys.myNnnVotes(v.user.id), v.target.id, isRetraction(v) ? undefined : v.vote),
    onError: (err, v) => {
      console.error("[common-notes] entry vote failed:", err);
      setCachedVote(client, queryKeys.myNnnVotes(v.user.id), v.target.id, v.previousVote);
    },
    onSettled: async (_result, _error, v) => {
      const fresh = await fetchNnnEntry(v.target.id);
      if (fresh) updateNnnInNoteSets(client, fresh);
    },
  });
  return async (entry, vote) => {
    const user = await actingUser().catch((err: unknown) => {
      console.error("[common-notes] entry vote failed:", err);
      return null;
    });
    if (!user) return;
    const previousVote = client.getQueryData<ReadonlyMap<string, Vote>>(queryKeys.myNnnVotes(user.id))?.get(entry.id);
    await mutateAsync({ target: entry, vote, user, previousVote }).catch(() => {});
  };
}
