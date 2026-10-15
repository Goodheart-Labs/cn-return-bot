import { AsyncLocalStorage } from "node:async_hooks";
import { OPENROUTER_NATIVE_WEB_SEARCH_TOOL, WEB_SEARCH_TOOL, webFetchNativeTool } from "../../pipeline/tool-calling/tools";

/** The model every LLM step of the everything pipeline runs on: the gate and
 *  split call, claim extraction and claim rating here, and the per-claim
 *  search, writer and verifier through the forced arms in checkClaims.ts.
 *  GPT-6 Luna costs $0.10 in and $0.50 out per million tokens, and its native
 *  web search $0.01 a search. It replaced Muse Spark 1.3 Contributor on
 *  2026-10-13, because Meta blocked our access again with "repeated policy
 *  violations", as it did on 2026-10-01 (GOO-303). Switching back to Muse is
 *  this constant, the forced arms in checkClaims.ts and the weights in
 *  abTestsData.ts. */
const EVERYTHING_MODEL = "openai/gpt-6-luna";

type ReasoningEffort = "low" | "medium" | "high";

/** The model and research tools behind the gate and split call, extraction
 *  and rating. A reasoning effort left undefined is not sent, so the provider's
 *  default applies. */
export interface ExtractionModels {
  model: string;
  reasoning: { gate?: ReasoningEffort; extraction: ReasoningEffort; rating: ReasoningEffort };
  /** The server-side tools the rater researches with, inside its one request. */
  ratingTools: object[];
}

const PRODUCTION_MODELS: ExtractionModels = {
  model: EVERYTHING_MODEL,
  // Luna runs at medium effort throughout, as it did during the first block.
  // The rater researches through the search tool, so it does not need to think
  // long on its own. High effort would only add reasoning tokens.
  reasoning: { extraction: "medium", rating: "medium" },
  // The provider's own search tooling, which also opens pages (GOO-258).
  ratingTools: [OPENROUTER_NATIVE_WEB_SEARCH_TOOL],
};

/** The limits the Opus rater ran with before the move to Muse. A fetched page
 *  is billed as input tokens, hence the cap per page. */
const CLAUDE_MAX_SEARCHES = 12;
const CLAUDE_MAX_FETCHES = 6;
const CLAUDE_MAX_TOKENS_PER_PAGE = 20_000;

/** Extraction and rating on a Claude model, researching with Claude's own
 *  search and fetch tools. The claimchecker lab in scripts_jim uses this. */
export function claudeExtractionModels(model: string, reasoning: ReasoningEffort): ExtractionModels {
  return {
    model,
    reasoning: { gate: reasoning, extraction: reasoning, rating: reasoning },
    ratingTools: [
      { ...WEB_SEARCH_TOOL, max_uses: CLAUDE_MAX_SEARCHES },
      webFetchNativeTool({ maxUses: CLAUDE_MAX_FETCHES, maxContentTokens: CLAUDE_MAX_TOKENS_PER_PAGE }),
    ],
  };
}

const activeModels = new AsyncLocalStorage<ExtractionModels>();

/** Runs `fn` with extraction and rating on other models than production's. */
export function withExtractionModels<T>(models: ExtractionModels, fn: () => T): T {
  return activeModels.run(models, fn);
}

export function extractionModels(): ExtractionModels {
  return activeModels.getStore() ?? PRODUCTION_MODELS;
}
