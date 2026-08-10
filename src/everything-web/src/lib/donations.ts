import type { DonationPair } from "./donationScoring";
import { createLocalPreference } from "./preference";
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

/** The stored charity preference. Future donations are minted with it. A
 *  donation box never displays this value. It displays the charity on its own
 *  ledger row, because the box must never show a charity the ledger does not
 *  hold. */
export const usePreferredCharity = createLocalPreference<CharityId>("cn-preferred-charity", {
  parse: (raw) => (isCharityId(raw) ? raw : CHARITIES[0].id),
  serialize: (charity) => charity,
});

/** The donation a cast vote minted. It carries the vote id, the charity the
 *  ledger row was written with, and the frozen pair of amounts. Callers hold
 *  null instead when the vote was retracted, or when the vote mints no donation
 *  at all, which is what happens on your own note. */
export interface MintedDonation {
  voteId: string;
  charity: CharityId;
  pair: DonationPair;
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
