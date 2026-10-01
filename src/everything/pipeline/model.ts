/** The model every LLM step of the everything pipeline runs on: the gate and
 *  split call, claim extraction and claim rating here, and the per-claim
 *  search, writer and verifier through the forced arms in checkClaims.ts.
 *  GPT-6 Luna costs $0.10 in and $0.50 out per million tokens, and its native
 *  web search $0.01 a search. It runs at medium reasoning effort, which
 *  llm.ts sets for every Luna call. It replaced Muse Spark 1.3 Contributor on
 *  2026-10-01, after Meta blocked our access with "repeated policy violations"
 *  (GOO-303). */
export const EVERYTHING_MODEL = "openai/gpt-6-luna";
