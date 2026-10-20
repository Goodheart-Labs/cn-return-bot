/**
 * The simple bot's search stage.
 *
 * This is a thin wrapper. It hands the work to the provider helper that
 * config.web_search selects, then records what the call cost. The helpers live
 * in searchDispatch.ts, which also assembles the system prompt and the JSON
 * schema they all share.
 */

import { trackLlmCall } from "../cost-tracking/costTracker";
import { COST } from "../utils/noteWriterSteps";
import { dispatchSearch } from "./searchDispatch";

/** A further turn in the conversation of the research call. The second research round sends one: the researcher's own earlier answer, then a new message. */
export interface ResearchFollowUp {
  /** The researcher's earlier answer as it gave it, as JSON text. */
  answer: string;
  message: string;
}

export interface SearchResult {
  findings: string;
  /** The researcher's answer as JSON text, so that a follow-up can continue its conversation. Missing for a provider that cannot take a follow-up. */
  answer?: string;
  correctionNeeded: boolean;
  /** Which research produced the findings: the cascade's quick research or a full one. Missing when the run has no cascade, which means a full one. */
  researchedBy?: "quick" | "full";
}

export async function runSearch(userMessage: string, followUp?: ResearchFollowUp): Promise<SearchResult> {
  const { findings, answer, correctionNeeded, costEntry } = await dispatchSearch(
    userMessage,
    COST.search,
    followUp,
  );
  trackLlmCall(costEntry);
  return { findings, answer, correctionNeeded };
}
