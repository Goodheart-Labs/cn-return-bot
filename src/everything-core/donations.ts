import type { User } from "@supabase/supabase-js";
import { castVote, type Vote } from "./votes";
import { supabase } from "./supabase";

/** The charities a voter can direct their donation to. The first entry is the
 *  default. */
export const CHARITIES = [
  { id: "give_directly", label: "GiveDirectly" },
  { id: "givewell", label: "GiveWell Recommended Charities" },
  { id: "ace", label: "Animal Charity Evaluators Recommended Charities" },
  { id: "ea_ltff", label: "EA Long-Term Future Fund" },
] as const;

export type CharityId = (typeof CHARITIES)[number]["id"];

const isCharityId = (v: unknown): v is CharityId => CHARITIES.some((c) => c.id === v);

/** The charity preference. The account is the source of truth: the choice is
 *  stored in the auth user's metadata, so it follows the user across devices,
 *  browsers, and both apps. localStorage is only a cache and a fallback for
 *  choices made before this existed. It cannot be the store itself, because a
 *  content script's localStorage belongs to the host page, which made the
 *  extension remember the choice per website. Future donations are minted
 *  with this value. A donation box never displays it. It displays the charity
 *  on its own ledger row, because the box must never show a charity the
 *  ledger does not hold. */
const PREFERRED_CHARITY_KEY = "cn-preferred-charity";

export function preferredCharity(user?: User | null): CharityId {
  const fromAccount = user?.user_metadata?.charity;
  if (isCharityId(fromAccount)) return fromAccount;
  try {
    const raw = localStorage.getItem(PREFERRED_CHARITY_KEY);
    return isCharityId(raw) ? raw : CHARITIES[0].id;
  } catch {
    return CHARITIES[0].id;
  }
}

/** Remembers a picked charity on the account and in the local cache. The
 *  metadata write is fire-and-forget: if it fails, only the cross-device
 *  memory is lost, never the pick that was already applied to its ledger
 *  row. */
export function rememberCharity(charity: CharityId): void {
  try {
    localStorage.setItem(PREFERRED_CHARITY_KEY, charity);
  } catch {
    // A browser that refuses storage still gets the account write below.
  }
  void supabase.auth.updateUser({ data: { charity } }).then(
    () => {},
    () => {},
  );
}

/** The two amounts of a donation. The first is donated if the note settles
 *  rated helpful, the second if it settles rated not helpful. The database
 *  prices them when the donation row is written (migration 207). */
export interface DonationPair {
  ifHelpful: number;
  ifNotHelpful: number;
}

/** The donation a cast vote minted. It carries the vote id, the charity the
 *  ledger row was written with, and the frozen pair of amounts. Callers hold
 *  null instead when the vote was retracted. */
export interface MintedDonation {
  voteId: string;
  charity: CharityId;
  pair: DonationPair;
}

/** Mints the donation a vote earns and returns its amounts. A database
 *  trigger prices the vote against the note's tally without it and freezes the
 *  pair in the row. The unique constraint on vote_id turns this into an update
 *  when someone votes again, so one vote can never mint two donations, and the
 *  trigger prices a changed vote again. */
async function saveDonation(voteId: string, charity: CharityId): Promise<DonationPair> {
  const { data, error } = await supabase
    .from("everything_donations")
    .upsert({ vote_id: voteId, charity }, { onConflict: "vote_id" })
    .select("amount_if_helpful, amount_if_not_helpful")
    .single();
  if (error) throw error;
  if (data.amount_if_helpful === null || data.amount_if_not_helpful === null) throw new Error("the database did not price the donation");
  return { ifHelpful: data.amount_if_helpful, ifNotHelpful: data.amount_if_not_helpful };
}

/** Redirects an already-minted donation to a different charity. It throws
 *  unless the ledger row really changed. Asking for the updated row back turns
 *  an update that matched no rows into a failure too, so the caller can roll
 *  the display back instead of showing a charity the ledger does not hold. Jim
 *  hit exactly that on 2026-07-21. */
export async function setDonationCharity(voteId: string, charity: CharityId): Promise<void> {
  const { data, error } = await supabase.from("everything_donations").update({ charity }).eq("vote_id", voteId).select("charity");
  if (error) throw error;
  if (data.length !== 1) throw new Error("the donation row was not updated");
}

/** Casts a vote on a note and mints the donation it earns. The donation goes
 *  to the charity remembered on the account, and the donation notice lets the
 *  voter redirect it afterwards. If only the donation fails to save, the vote
 *  stays and null says no donation was promised. */
export async function castVoteWithDonation(params: {
  noteId: string;
  vote: Vote;
  user: User;
  platform: "web" | "extension";
}): Promise<MintedDonation | null> {
  const { user } = params;
  const voteId = await castVote(params.noteId, user.id, params.vote, params.platform);
  const charity = preferredCharity(user);
  try {
    return { voteId, charity, pair: await saveDonation(voteId, charity) };
  } catch (err) {
    console.error("[common-notes] the vote was cast but its donation was not saved:", err);
    return null;
  }
}

/** Mints the donation for the author's automatic Helpful vote, which a
 *  database trigger casts the moment a note is inserted. The trigger writes
 *  the vote row directly, so the client mints its donation here, priced like
 *  every clicked vote. The note is already saved at this point, so a failure
 *  is logged and never thrown. */
export async function mintSelfVoteDonation(noteId: string, author: User): Promise<MintedDonation | null> {
  try {
    const { data: vote, error } = await supabase
      .from("everything_votes")
      .select("id")
      .eq("note_id", noteId)
      .eq("voter_id", author.id)
      .single();
    if (error) throw error;
    const charity = preferredCharity(author);
    const pair = await saveDonation(vote.id, charity);
    return { voteId: vote.id, charity, pair };
  } catch (err) {
    console.warn("[common-notes] could not mint the self-vote donation:", err);
    return null;
  }
}
