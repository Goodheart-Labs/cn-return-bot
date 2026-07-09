import { supabase } from "./supabase";

export type Vote = 1 | -1;

// The voter's anonymous identity: a random UUID minted on first visit, kept in
// localStorage. The DB dedupes votes on (note_id, voter_id), and since voter
// ids are unreadable (no select on everything_votes) and unguessable, the only
// vote anyone can change is their own.
const VOTER_ID_KEY = "cn-everything-voter-id";
const MY_VOTES_KEY = "cn-everything-my-votes";

function getVoterId(): string {
  let id = localStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}

/** My own votes by note id — only used to highlight the pressed button. */
export function getMyVotes(): Record<string, Vote> {
  try {
    return JSON.parse(localStorage.getItem(MY_VOTES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export async function castVote(noteId: string, vote: Vote): Promise<void> {
  localStorage.setItem(MY_VOTES_KEY, JSON.stringify({ ...getMyVotes(), [noteId]: vote }));
  const { error } = await supabase.rpc("cast_everything_vote", {
    p_note_id: noteId,
    p_voter_id: getVoterId(),
    p_vote: vote,
  });
  if (error) throw new Error(error.message);
}
