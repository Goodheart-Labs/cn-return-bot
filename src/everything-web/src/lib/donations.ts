import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

/** The charities a voter can direct their $2 to. First entry is the default. */
export const CHARITIES = [
  { id: "give_directly", label: "GiveDirectly" },
  { id: "givewell", label: "GiveWell Recommended Charities" },
  { id: "ace", label: "Animal Charity Evaluators Recommended Charities" },
  { id: "ea_ltff", label: "EA Long-Term Future Fund" },
] as const;

export type CharityId = (typeof CHARITIES)[number]["id"];

// The charity choice is one preference shared by every reasoning box on the
// page (and remembered across reloads) — pick once, it's picked everywhere.
const CHARITY_KEY = "cn-preferred-charity";
const isCharityId = (v: unknown): v is CharityId => CHARITIES.some((c) => c.id === v);

const charityListeners = new Set<() => void>();
function readPreferredCharity(): CharityId {
  const stored = localStorage.getItem(CHARITY_KEY);
  return isCharityId(stored) ? stored : CHARITIES[0].id;
}

/** Shared, persisted charity preference. All mounted pickers read + write this,
 *  so selecting one updates every box live and future ones open pre-selected. */
export function usePreferredCharity(): [CharityId, (c: CharityId) => void] {
  const charity = useSyncExternalStore(
    (onChange) => {
      charityListeners.add(onChange);
      return () => charityListeners.delete(onChange);
    },
    readPreferredCharity,
    () => CHARITIES[0].id, // server snapshot (no localStorage during SSR/build)
  );
  const setCharity = (c: CharityId) => {
    localStorage.setItem(CHARITY_KEY, c);
    charityListeners.forEach((fn) => fn());
  };
  return [charity, setCharity];
}

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
