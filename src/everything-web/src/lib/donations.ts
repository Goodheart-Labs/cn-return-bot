import type { DonationPair } from "./donationScoring";
import { createLocalPreference } from "./preference";
import { supabase } from "../../../everything-shared/supabase";

/** The charities a voter can direct their donation to. First entry is the default. */
export const CHARITIES = [
  { id: "give_directly", label: "GiveDirectly" },
  { id: "givewell", label: "GiveWell Recommended Charities" },
  { id: "ace", label: "Animal Charity Evaluators Recommended Charities" },
  { id: "ea_ltff", label: "EA Long-Term Future Fund" },
] as const;

export type CharityId = (typeof CHARITIES)[number]["id"];

const isCharityId = (v: unknown): v is CharityId => CHARITIES.some((c) => c.id === v);

/** Persisted charity preference: the default future donations are minted with.
 *  Each donation box displays its OWN row's charity, not this — the box must
 *  never show a charity the ledger doesn't hold. */
export const usePreferredCharity = createLocalPreference<CharityId>("cn-preferred-charity", {
  parse: (raw) => (isCharityId(raw) ? raw : CHARITIES[0].id),
  serialize: (charity) => charity,
});

/** A cast vote's minted donation: the vote id, the charity the ledger row was
 *  written with, and the frozen outcome-contingent pair. Null carrier = retract
 *  or a vote that mints no donation, e.g. on your own note. */
export interface MintedDonation {
  voteId: string;
  charity: CharityId;
  pair: DonationPair;
}

/** Mint the donation a vote earns: the outcome-contingent pair frozen at vote
 *  time. unique(vote_id) makes this an update on a re-vote — one vote can
 *  never mint two donations. */
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

/** Redirect an already-minted donation to a different charity. Resolves true
 *  only when the ledger row verifiably changed — the `.select()` echo turns a
 *  silently-matched-zero-rows update (or any transient failure) into `false`
 *  so the caller can roll the UI back instead of showing a charity the ledger
 *  doesn't hold (Jim hit exactly that on 2026-07-21). */
export async function setDonationCharity(voteId: string, charity: CharityId): Promise<boolean> {
  const { data, error } = await supabase
    .from("everything_donations")
    .update({ charity })
    .eq("vote_id", voteId)
    .select("charity");
  return !error && data.length === 1;
}
