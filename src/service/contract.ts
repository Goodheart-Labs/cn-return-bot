/**
 * The wire contract between the callers and the two services.
 *
 * The services are pure functions behind HTTP. One takes a claim and answers
 * whether it needs a note. The other takes some content and answers with the
 * claims in it. Neither touches our database, so everything a caller needs to
 * record afterwards has to travel back in the response. That is why a check
 * answers with the whole run record and not just the note.
 *
 * Both sides import this file, so a change here is a change both sides see.
 */

import type { Post } from "../api/fetchEligiblePosts";
import type { ExtractedClaim, FetchedContent, ClaimCheck } from "../everything/types";

export const CHECK_CLAIM_PATH = "/check-claim";
export const EXTRACT_CLAIMS_PATH = "/extract-claims";
export const HEALTH_PATH = "/health";

/** Callers prove themselves with a shared secret in this header. The services
 *  hold no database credentials, but a call still costs money to serve. */
export const SERVICE_AUTH_HEADER = "x-cn-service-key";

/** What kind of work a call is. A service serves the highest first, and the
 *  checker keeps slots free for reader work so a reader never waits behind a
 *  long video. `reader` is a page or paragraph someone asked for and is waiting
 *  on, `x` is the note writer working through the X feed, and `feed` is the
 *  followed-feed backlog that nobody is watching. */
export type WorkPriority = "reader" | "x" | "feed";

/** Highest first. The queue inside each service orders calls by this. */
export const WORK_PRIORITY_ORDER: Record<WorkPriority, number> = {
  reader: 2,
  x: 1,
  feed: 0,
};

// ---------------------------------------------------------------------------
// Checking one claim
// ---------------------------------------------------------------------------

/** A claim reaches the checker dressed as a post, because the pipeline behind it
 *  was built for tweets. The X note writer therefore sends its tweet unchanged,
 *  and a caller with a claim from an article wraps it first with
 *  `buildClaimPost`. */
export interface CheckClaimRequest {
  priority: WorkPriority;
  post: Post;
}

/** Everything the caller needs to write one `everything_pipeline_runs` row.
 *  The service produces these numbers and logs but cannot store them, so they
 *  come back here and the caller owns the ledger. */
export interface ClaimRunRecord {
  botName: string;
  outcome: string;
  outcomeReason: string | null;
  finalStage: string | null;
  abTestPicks: Record<string, string> | null;
  botConfig: Record<string, unknown> | null;
  /** The full nested run log, the same shape that is stored today. */
  logs: Record<string, unknown> | null;
  /** What this one call spent, in US dollars. Null when no cost was recorded. */
  costUsd: number | null;
}

export interface CheckClaimResponse {
  /** Either the note with its verified sources, or the reason no note was
   *  written. This is the same shape the in-process path returns today. */
  check: ClaimCheck;
  run: ClaimRunRecord;
}

// ---------------------------------------------------------------------------
// Extracting the claims from a piece of content
// ---------------------------------------------------------------------------

/** The content goes over the wire in the shape the pipeline already fetches it,
 *  so a caller that has fetched a page or a transcript sends it as it stands.
 *  For a video this carries the subtitle cues, which is what lets each claim
 *  keep the timestamp it was spoken at. */
export interface ExtractClaimsRequest {
  priority: WorkPriority;
  content: FetchedContent;
}

export interface ExtractClaimsResponse {
  /** Every claim found, including the ones not worth checking. The caller
   *  decides what to do with them, using `shouldFactCheck` and
   *  `dropSpeculation`, so that the extraction service stays a pure reader of
   *  text with no policy of its own. */
  claims: ExtractedClaim[];
  costUsd: number | null;
}

// ---------------------------------------------------------------------------
// Health, which is also how callers decide whether to start at all
// ---------------------------------------------------------------------------

export type ServiceName = "claim-check" | "extraction";

/** The health answer carries numbers rather than just saying "alive", because a
 *  service can be running and answering while making no progress. That happens
 *  when every slot holds a call waiting on a network request that never
 *  returns, and a plain ping cannot tell it apart from a healthy service. */
export interface HealthResponse {
  service: ServiceName;
  /** Calls being worked right now. */
  inFlight: number;
  /** Calls accepted and waiting for a free slot. */
  waiting: number;
  /** How long the oldest waiting call has waited, in seconds. Null when nothing
   *  is waiting. */
  oldestWaitSeconds: number | null;
  /** How many calls this service works at once. */
  concurrency: number;
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/** A service answers with this and a 4xx or 5xx status when it cannot serve the
 *  call. The caller treats it the same way it treats a connection that dropped:
 *  record the failure against the claim and move on. */
export interface ServiceErrorResponse {
  error: string;
}
