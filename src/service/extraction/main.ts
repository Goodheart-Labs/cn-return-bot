/**
 * The claim-extraction service. It takes a piece of content and answers with
 * the claims in it. Its second route rates a list of extracted claims with web
 * research, which is what decides which of them are worth a fact-check.
 *
 * It writes nothing, checks nothing, and decides nothing. Which claims are
 * worth checking is the caller's business, so every claim found comes back,
 * including the confidently-true ones and the speculation, and the ratings
 * come back as judgements rather than as a filtered list.
 *
 *   bun run src/service/extraction/main.ts
 */

import "dotenv/config";
import { extractClaims } from "../../everything/pipeline/extractClaims";
import { rateClaims } from "../../everything/pipeline/rateClaims";
import { aggregateAndLogCosts, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import {
  EXTRACT_CLAIMS_PATH,
  RATE_CLAIMS_PATH,
  type ExtractClaimsRequest,
  type ExtractClaimsResponse,
  type RateClaimsRequest,
  type RateClaimsResponse,
} from "../contract";
import { numberFromEnv, startService, type ServiceRoute } from "../serve";

/** Two documents at a time. Each one is already several large-model calls that
 *  run their chunks in parallel inside the call, so a third document in flight
 *  buys little and competes with them. */
const DEFAULT_CONCURRENCY = 2;

/** How many chunks of one document are read at once. This is the number the
 *  in-process path has always used. */
const DEFAULT_CHUNK_CONCURRENCY = 3;

/** Extraction is quick next to a claim check, so a reader's document is never
 *  stuck behind a long one for more than a couple of minutes. No slot is held
 *  back; the priority order alone is enough here. */
const RESERVED_FOR_READER = 0;

const DEFAULT_PORT = 8788;

const chunkConcurrency = numberFromEnv("EXTRACTION_CHUNK_CONCURRENCY", DEFAULT_CHUNK_CONCURRENCY);

const extractClaimsRoute: ServiceRoute<ExtractClaimsRequest, ExtractClaimsResponse> = {
  path: EXTRACT_CLAIMS_PATH,
  priorityOf: (body) => body.priority,
  handle: async (body) => {
    if (!body?.content?.kind) throw new Error("Extraction needs content with a kind");
    // The cost tracker collects what the extraction's model calls cost, both
    // the per-chunk extraction calls and the image descriptions. The caller
    // records the total against the daily spend cap.
    const { claims, cost } = await withCostTracker(async () => {
      const found = await extractClaims(body.content, chunkConcurrency);
      return { claims: found, cost: aggregateAndLogCosts() };
    });
    console.log(`[extraction] ${body.priority} ${body.content.kind} ${body.content.url}: ${claims.length} claims`);
    return { claims, costUsd: cost?.cost ?? null };
  },
};

const rateClaimsRoute: ServiceRoute<RateClaimsRequest, RateClaimsResponse> = {
  path: RATE_CLAIMS_PATH,
  priorityOf: (body) => body.priority,
  handle: async (body) => {
    if (typeof body?.text !== "string" || !Array.isArray(body?.claims)) {
      throw new Error("Rating needs the item's text and its claims");
    }
    const rating = await rateClaims(body.text, body.claims, body.source);
    console.log(
      `[extraction] ${body.priority} rated ${rating.claims.length} claims ` +
        `(${rating.webSearches} web searches, $${rating.cost.cost.toFixed(2)})`,
    );
    return {
      claims: rating.claims,
      research: rating.research,
      webSearches: rating.webSearches,
      costUsd: rating.cost.cost,
    };
  },
};

startService({
  name: "extraction",
  port: numberFromEnv("EXTRACTION_PORT", DEFAULT_PORT),
  concurrency: numberFromEnv("EXTRACTION_CONCURRENCY", DEFAULT_CONCURRENCY),
  reservedForReader: RESERVED_FOR_READER,
  routes: [extractClaimsRoute, rateClaimsRoute],
});
