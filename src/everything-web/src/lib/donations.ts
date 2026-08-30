import type { User } from "@supabase/supabase-js";
import type { DonationPair } from "./donationScoring";
import { supabase } from "../../../everything-shared/supabase";

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

/** The donation a cast vote minted. It carries the vote id, the charity the
 *  ledger row was written with, and the frozen pair of amounts. Callers hold
 *  null instead when the vote was retracted. */
export interface MintedDonation {
  voteId: string;
  charity: CharityId;
  pair: DonationPair;
}

/* Posting a note mints a donation for the author's automatic Helpful vote,
 * but the note's card does not exist yet at that moment. The mint is parked
 * here under the note id, and the card claims it when it first renders, so
 * the donation notice appears under the fresh note the same way it would
 * after a click. The map never grows past a handful of entries, because every
 * render of a note card takes its entry out. */
const mintedByNote = new Map<string, MintedDonation>();
export const parkMintedDonation = (noteId: string, donation: MintedDonation) => mintedByNote.set(noteId, donation);
export function takeMintedDonation(noteId: string): MintedDonation | null {
  const donation = mintedByNote.get(noteId) ?? null;
  mintedByNote.delete(noteId);
  return donation;
}

/** Mint the donation a vote earns, which is the pair of amounts frozen at vote
 *  time. The unique constraint on vote_id turns this into an update when someone
 *  votes again, so one vote can never mint two donations. */
export function saveDonation(voteId: string, charity: CharityId, pair: DonationPair) {
  return supabase.from("everything_donations").upsert(
    {
      vote_id: voteId,
      charity,
      amount_if_helpful: pair.ifHelpful,
      amount_if_not_helpful: pair.ifNotHelpful,
    },
    { onConflict: "vote_id" },
  );
}

/** Redirect an already-minted donation to a different charity. It resolves true
 *  only when the ledger row really changed. Asking for the updated row back
 *  turns an update that matched no rows, or any other transient failure, into
 *  false. The caller can then roll the display back instead of showing a charity
 *  the ledger does not hold. Jim hit exactly that on 2026-07-21. */
export async function setDonationCharity(voteId: string, charity: CharityId): Promise<boolean> {
  const { data, error } = await supabase
    .from("everything_donations")
    .update({ charity })
    .eq("vote_id", voteId)
    .select("charity");
  return !error && data.length === 1;
}
