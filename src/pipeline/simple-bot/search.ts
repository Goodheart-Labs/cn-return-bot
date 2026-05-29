/**
 * Simple Bot — Search
 *
 * Thin wrapper that dispatches to the right provider helper based on
 * config.web_search. The shared system prompt + JSON schema and the
 * per-provider implementations live in searchDispatch.ts.
 */

import { trackLlmCall } from "../cost-tracking/costTracker";
import { STEP } from "../utils/noteWriterSteps";
import { dispatchSearch } from "./searchDispatch";

export interface SearchResult {
  findings: string;
  correctionNeeded: boolean;
}

export async function runSearch(userMessage: string): Promise<SearchResult> {
  const { findings, correctionNeeded, costEntry } = await dispatchSearch(
    userMessage,
    STEP.search,
  );
  trackLlmCall(costEntry);
  return { findings, correctionNeeded };
}
