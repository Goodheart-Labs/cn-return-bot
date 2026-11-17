import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { track } from "@cn/core/analytics";
import { castVoteWithDonation, type MintedDonation } from "@cn/core/donations";
import { currentPlatform } from "@cn/core/extensionStorage";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes, fetchNnnEntry } from "@cn/core/noteNotNeeded";
import { fetchNote } from "@cn/core/notes";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { castVote, clearVote, fetchMyVotes, type Vote } from "@cn/core/votes";
import { useActingUser } from "../auth/useActingUser";
import { useSession } from "../auth/useSession";
import { mutationKeys, queryKeys } from "../query/queryKeys";
import { upsertNnnInNoteSets, updateNoteInNoteSets } from "./noteSet";

const NO_VOTES: ReadonlyMap<string, Vote> = new Map();

/** The signed-in reader's own votes on notes, keyed by note id. It is
 *  undefined while the session or the votes are still loading. A reader
 *  without a session has no votes, so they get an empty map. */
export function useLoadedMyVotes(): ReadonlyMap<string, Vote> | undefined {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const { data } = useQuery({ queryKey: queryKeys.myVotes(userId), queryFn: fetchMyVotes, enabled: !!userId });
  if (!ready) return undefined;
  return userId ? data : NO_VOTES;
}

/** The signed-in reader's own votes on notes, keyed by note id. It is empty
 *  while they load. */
export const useMyVotes = (): ReadonlyMap<string, Vote> => useLoadedMyVotes() ?? NO_VOTES;

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

/** Pressing the pill that is already lit retracts the vote. */
const isRetraction = (vote: Vote, previousVote: Vote | undefined) => vote === previousVote;

/** What one kind of vote needs: where the reader's own votes of that kind are
 *  cached, how a vote is saved and retracted, and how the target is read
 *  again once it is saved. */
interface Voting<T, R> {
  votesKey: (userId: string) => readonly unknown[];
  cast: (target: T, vote: Vote, previousVote: Vote | undefined, user: User) => Promise<R>;
  clear: (targetId: string) => Promise<void>;
  refresh: (client: QueryClient, target: T) => Promise<void>;
  onSignedOut?: (target: T) => void;
}

/** Returns the function that casts, changes or retracts a vote of one kind.
 *  The pill lights up at once, and it goes dark again if saving fails. Once
 *  saved, the target is read again, because database triggers compute the
 *  counts, and every surface showing it gets the new counts.
 *
 *  The function resolves to what saving the vote returned. It resolves to null
 *  when the vote was retracted, when it failed, and when the reader has to
 *  sign in first. */
function useVoting<T extends { id: string }, R>({ votesKey, cast, clear, refresh, onSignedOut }: Voting<T, R>): (target: T, vote: Vote) => Promise<R | null> {
  const client = useQueryClient();
  const actingUser = useActingUser();
  const { mutateAsync } = useMutation({
    mutationKey: mutationKeys.vote,
    mutationFn: async ({ target, vote, previousVote, user }: { target: T; vote: Vote; previousVote: Vote | undefined; user: User }) =>
      isRetraction(vote, previousVote) ? (await clear(target.id), null) : cast(target, vote, previousVote, user),
    onMutate: ({ target, vote, previousVote, user }) => setCachedVote(client, votesKey(user.id), target.id, isRetraction(vote, previousVote) ? undefined : vote),
    onError: (err, { target, previousVote, user }) => {
      console.error("[common-notes] vote failed:", err);
      setCachedVote(client, votesKey(user.id), target.id, previousVote);
    },
    onSettled: (_result, _error, { target }) => refresh(client, target),
  });
  return async (target, vote) => {
    const user = await actingUser();
    if (!user) {
      onSignedOut?.(target);
      return null;
    }
    const previousVote = client.getQueryData<ReadonlyMap<string, Vote>>(votesKey(user.id))?.get(target.id);
    return mutateAsync({ target, vote, user, previousVote }).catch(() => null);
  };
}

/** Returns the function that casts, changes or retracts a vote on a note. It
 *  resolves to the donation the vote minted. */
export const useVoteOnNote = (): ((note: NoteRow, vote: Vote) => Promise<MintedDonation | null>) =>
  useVoting({
    votesKey: queryKeys.myVotes,
    cast: (note: NoteRow, vote, previousVote, user) => castVoteWithDonation({ note, vote, previousVote, user, platform: currentPlatform() }),
    clear: clearVote,
    refresh: async (client, note) => {
      const fresh = await fetchNote(note.id);
      if (fresh) updateNoteInNoteSets(client, fresh);
    },
    onSignedOut: (note) => track("vote_gated_login", { note_id: note.id }),
  });

/** Returns the function that casts, changes or retracts a vote on a
 *  note-not-needed entry. It works like a note vote, except that entry votes
 *  never mint a donation. */
export const useVoteOnNnn = (): ((entry: NnnRow, vote: Vote) => Promise<void | null>) =>
  useVoting({
    votesKey: queryKeys.myNnnVotes,
    cast: (entry: NnnRow, vote, _previousVote, user) => castNnnVote(entry.id, user.id, vote),
    clear: clearNnnVote,
    refresh: async (client, entry) => {
      const fresh = await fetchNnnEntry(entry.id);
      if (fresh) upsertNnnInNoteSets(client, fresh);
    },
  });

/** Returns the function that casts, changes or retracts a vote on one of our
 *  X notes, given the id of its twin in everything_notes. It is an ordinary
 *  note vote. It mints no donation, because donations are about Common Notes'
 *  own notes. */
export const useVoteOnXNote = (): ((twin: { id: string }, vote: Vote) => Promise<string | null>) =>
  useVoting({
    votesKey: queryKeys.myVotes,
    cast: (twin: { id: string }, vote, _previousVote, user) => castVote(twin.id, user.id, vote, currentPlatform()),
    clear: clearVote,
    refresh: (client) => client.invalidateQueries({ queryKey: queryKeys.noteTallies }),
  });
