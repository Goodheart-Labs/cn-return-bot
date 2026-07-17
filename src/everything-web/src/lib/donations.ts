import { createLocalPreference } from "./preference";
import { supabase } from "./supabase";

/** The charities a voter can direct their $2 to. First entry is the default. */
export const CHARITIES = [
  { id: "give_directly", label: "GiveDirectly" },
  { id: "givewell", label: "GiveWell Recommended Charities" },
  { id: "ace", label: "Animal Charity Evaluators Recommended Charities" },
  { id: "ea_ltff", label: "EA Long-Term Future Fund" },
] as const;

export type CharityId = (typeof CHARITIES)[number]["id"];

const isCharityId = (v: unknown): v is CharityId => CHARITIES.some((c) => c.id === v);

/** Shared, persisted charity preference. All mounted pickers read + write this,
 *  so selecting one updates every box live and future ones open pre-selected. */
export const usePreferredCharity = createLocalPreference<CharityId>("cn-preferred-charity", {
  parse: (raw) => (isCharityId(raw) ? raw : CHARITIES[0].id),
  serialize: (charity) => charity,
});

/** Record the $2 earned by a vote-with-reasoning. unique(vote_id) makes this
 *  an update on resubmit — one vote can never mint two donations. */
export function saveDonation(voteId: string, charity: CharityId) {
  return supabase
    .from("everything_donations")
    .upsert({ vote_id: voteId, charity }, { onConflict: "vote_id" });
}

/** Attach private reasoning to the caller's own vote row. (Reasoning posted as
 *  a comment lives on the comment instead.) */
export function setVoteReasoning(voteId: string, reasoning: string) {
  return supabase.from("everything_votes").update({ reasoning }).eq("id", voteId);
}
