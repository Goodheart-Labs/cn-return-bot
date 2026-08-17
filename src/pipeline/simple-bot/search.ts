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

export interface SearchResult {
  findings: string;
  correctionNeeded: boolean;
}

export async function runSearch(userMessage: string): Promise<SearchResult> {
  const { findings, correctionNeeded, costEntry } = await dispatchSearch(
    userMessage,
    COST.search,
  );
  trackLlmCall(costEntry);
  return { findings, correctionNeeded };
}
