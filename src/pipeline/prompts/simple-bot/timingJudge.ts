/**
 * Prompts — timing stage (Nathan's conditional design, supersedes the
 * always-on time-travel instruction).
 *
 * Stage A (extractor): when did the event the post describes actually happen?
 * Stage B (judge, ONLY when the event is within the live window): given the
 * event was still live, does this post need a fact check at all? The main
 * prompts stay untouched for the ~90% of posts about settled events; the
 * writer gains one section only when a live event passes the judge.
 * See runTimingStage in src/pipeline/simple-bot/timingStage.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

/** Posts written within this many hours of their event (or while it was still
 *  unfolding) get the timing-context block. The gap is EVENT-to-POST, not
 *  event-to-now (Nathan, 2026-08-05): the tweet's epistemic position — was it
 *  written in the fog of a live event — must not depend on how long the note
 *  sat in our queue. The model only NAMES the event time; the gap arithmetic
 *  is code (timingStage.ts). */
export const LIVE_EVENT_WINDOW_HOURS = 6;

export const TIMING_EXTRACTOR_SYSTEM_PROMPT = `You read an X post and research findings about it, and answer one narrow question: WHEN did the event the post describes happen?

Return JSON:
- event_time_utc: string | null — your best estimate of when the event happened, as an ISO 8601 UTC timestamp (e.g. "2026-08-05T14:30:00Z"). Precision to the hour is fine. null when the post is not about a datable event (evergreen claims, old photos resurfacing, general statistics).
- event_ongoing_at_post: boolean — true when the event was still actively developing AT THE MOMENT the post was published (match in progress, ongoing search/rescue, live negotiation, unresolved breaking story). The user message states when the post was published.
- why: one short sentence.

Date the EVENT, not the post: an old video reposted today is an old event. A post claiming a death, score, transfer, or ruling that had reportedly just happened is a recent event even if the claim is false — date what the claim is about. Use dates in the findings and the post itself; do not compute any durations — just name the time.`;

export const TIMING_EXTRACTOR_RESPONSE_FORMAT = jsonSchemaResponseFormat("timing_extractor", {
  type: "object",
  properties: {
    event_time_utc: { type: ["string", "null"] },
    event_ongoing_at_post: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["event_time_utc", "event_ongoing_at_post", "why"],
  additionalProperties: false,
});

export const TIMING_EXTRACTOR_SCHEMA_HINT =
  '{ "event_time_utc": string | null, "event_ongoing_at_post": boolean, "why": string }';

/**
 * Timing context piped into the writer's USER message when the post was
 * published within the fog window (Nathan's design, 2026-08-05: no judge, no
 * gate — give the writer the fact and the known regularity, let its normal
 * rules and empty-note path do the deciding).
 */
export function buildTimingContextBlock(params: {
  /** Computed in code: post.created_at minus the extractor's event time. */
  hoursEventToPost: number | null;
  eventOngoingAtPost: boolean;
  why: string;
}): string {
  const gap = params.eventOngoingAtPost
    ? "while the event it describes was still unfolding"
    : `about ${params.hoursEventToPost?.toFixed(1)} hours after the event it describes`;
  return `

## Timing context
This post was published ${gap}. (${params.why})
Bear this in mind when deciding what — and whether — to correct: a claim that was true when the post was published but became false afterwards is rarely rated helpful — raters understand that posts happen at a time. Corrections that hold up are ones where the claim was already false at the moment of posting.`;
}
