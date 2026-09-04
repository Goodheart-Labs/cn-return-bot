/**
 * The claim-extraction service. It takes a piece of content and answers with
 * the claims in it.
 *
 * It writes nothing, checks nothing, and decides nothing. Which claims are
 * worth checking is the caller's business, so every claim found comes back,
 * including the confidently-true ones and the speculation.
 *
 *   bun run src/service/extraction/main.ts
 */

import "dotenv/config";
import { extractClaims } from "../../everything/pipeline/extractClaims";
import { aggregateAndLogCosts, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { EXTRACT_CLAIMS_PATH, type ExtractClaimsRequest, type ExtractClaimsResponse } from "../contract";
import { numberFromEnv, startService } from "../serve";

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

startService<ExtractClaimsRequest, ExtractClaimsResponse>({
  name: "extraction",
  port: numberFromEnv("EXTRACTION_PORT", DEFAULT_PORT),
  concurrency: numberFromEnv("EXTRACTION_CONCURRENCY", DEFAULT_CONCURRENCY),
  reservedForReader: RESERVED_FOR_READER,
  route: {
    path: EXTRACT_CLAIMS_PATH,
    priorityOf: (body) => body.priority,
    handle: async (body) => {
      if (!body?.content?.kind) throw new Error("Extraction needs content with a kind");
      // The cost tracker collects whatever the extraction reports. Today that
      // is the image descriptions only, because the claim extractor still calls
      // the model directly and reports nothing. Once it reports its own calls
      // this number becomes the full cost with no change here.
      const { claims, cost } = await withCostTracker(async () => {
        const found = await extractClaims(body.content, chunkConcurrency);
        return { claims: found, cost: aggregateAndLogCosts() };
      });
      console.log(`[extraction] ${body.priority} ${body.content.kind} ${body.content.url}: ${claims.length} claims`);
      return { claims, costUsd: cost?.cost ?? null };
    },
  },
});
