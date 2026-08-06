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
 *  unfolding) get the stage-B judge. The gap is EVENT-to-POST, not event-to-now
 *  (Nathan, 2026-08-05): what matters is the tweet's epistemic position — was
 *  it written in the fog of a live event — which must not depend on how long
 *  the note sat in our queue before we processed it. */
export const LIVE_EVENT_WINDOW_HOURS = 6;

export const TIMING_EXTRACTOR_SYSTEM_PROMPT = `You read an X post and research findings about it, and answer one narrow question: how close to the event it describes was this post PUBLISHED?

The user message states when the post was published. Return JSON:
- hours_event_to_post: number | null — hours between the event happening and the post being published. 0.5 means the post went up thirty minutes after the event. null when the post is not about a datable event (evergreen claims, old photos resurfacing, general statistics).
- event_ongoing_at_post: boolean — true when the event was still actively developing AT THE MOMENT the post was published (match in progress, ongoing search/rescue, live negotiation, unresolved breaking story).
- why: one short sentence.

Date the EVENT, not the post: an old video reposted today is an old event (large gap). A post claiming a death, score, transfer, or ruling that had reportedly just happened is a small gap even if the claim is false — measure to what the claim is about. Judge from the post's moment, not from today.`;

export const TIMING_EXTRACTOR_RESPONSE_FORMAT = jsonSchemaResponseFormat("timing_extractor", {
  type: "object",
  properties: {
    hours_event_to_post: { type: ["number", "null"] },
    event_ongoing_at_post: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["hours_event_to_post", "event_ongoing_at_post", "why"],
  additionalProperties: false,
});

export const TIMING_EXTRACTOR_SCHEMA_HINT =
  '{ "hours_event_to_post": number | null, "event_ongoing_at_post": boolean, "why": string }';

/**
 * Timing context piped into the writer's USER message when the post was
 * published within the fog window (Nathan's design, 2026-08-05: no judge, no
 * gate — give the writer the fact and the known regularity, let its normal
 * rules and empty-note path do the deciding).
 */
export function buildTimingContextBlock(params: {
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
