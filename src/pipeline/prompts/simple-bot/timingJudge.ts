/**
 * Prompts — timing stage. This is Nathan's conditional design, and it
 * supersedes the always-on time-travel instruction.
 *
 * One extractor call answers a single question. When did the event the post
 * describes actually happen? The code then works out how long after that event
 * the post was published.
 * Roughly 90% of posts are about settled events, and for them nothing changes.
 * Their prompts stay exactly as they are. Only a post that falls inside the live
 * window makes the writer's user message gain the timing-context block below.
 * There is no second judging call and no gate. The writer's own rules decide
 * what to do with the extra context. See runTimingStage in
 * src/pipeline/simple-bot/timingStage.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

/** A post written within this many hours of the event it describes gets the
 *  timing-context block. A post written while that event was still unfolding
 *  gets it too. The gap is measured from the event to the post, not from the
 *  event to now. Nathan decided this on 2026-08-05. What we want to know is
 *  whether the post was written in the fog of a live event, and that must not
 *  depend on how long the note then sat in our queue. The model only names the
 *  time of the event. The subtraction happens in code, in timingStage.ts. */
export const LIVE_EVENT_WINDOW_HOURS = 6;

export const TIMING_EXTRACTOR_SYSTEM_PROMPT = `You read an X post and research findings about it, and answer one narrow question: WHEN did the event the post describes happen?

Return JSON:
- event_time_utc: string | null — your best estimate of when the event happened, as an ISO 8601 UTC timestamp (e.g. "2026-08-05T14:30:00Z"). Precision to the hour is fine. null when the post is not about a datable event (evergreen claims, old photos resurfacing, general statistics).
- why: one short sentence.

Date the EVENT, not the post: an old video reposted today is an old event. A post claiming a death, score, transfer, or ruling that had reportedly just happened is a recent event even if the claim is false — date what the claim is about. For a claim about a still-developing situation (an ongoing search, a running count, a match in progress), the event is the latest development the claim rests on. Use dates in the findings and the post itself; do not compute any durations — just name the time.`;

export const TIMING_EXTRACTOR_RESPONSE_FORMAT = jsonSchemaResponseFormat("timing_extractor", {
  type: "object",
  properties: {
    event_time_utc: { type: ["string", "null"] },
    why: { type: "string" },
  },
  required: ["event_time_utc", "why"],
  additionalProperties: false,
});

export const TIMING_EXTRACTOR_SCHEMA_HINT =
  '{ "event_time_utc": string | null, "why": string }';

/**
 * The timing context that is piped into the writer's user message when the post
 * was published inside the fog window. Nathan designed it this way on
 * 2026-08-05. There is no judge and no gate. We hand the writer the fact and the
 * regularity we know about, and its normal rules and its empty-note path do the
 * deciding.
 */
export function buildTimingContextBlock(params: {
  /** Computed in code as post.created_at minus the event time the extractor
   *  named. */
  hoursEventToPost: number;
  why: string;
}): string {
  return `

## Timing context
According to an evaluator (a small model), this post was published about ${params.hoursEventToPost.toFixed(1)} hours after the event it describes. Its reasoning: ${params.why}

Bear this in mind when deciding what — and whether — to correct: a claim that was true when the post was published but became false afterwards is rarely rated helpful — raters understand that posts happen at a time. Corrections that hold up are ones where the claim was already false at the moment of posting.`;
}
