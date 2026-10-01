/** The model every LLM step of the everything pipeline runs on: the gate and
 *  split call, claim extraction and claim rating here, and the per-claim
 *  search, writer and verifier through the forced arms in checkClaims.ts. Muse
 *  Spark 1.3 on Meta's contributor tier costs $0.10 in and $0.20 out per million
 *  tokens, fifty times less than Sonnet 5 (GOO-159). The contributor tier means
 *  Meta may train on what we send. */
export const EVERYTHING_MODEL = "meta/muse-spark-1.3-contributor";
