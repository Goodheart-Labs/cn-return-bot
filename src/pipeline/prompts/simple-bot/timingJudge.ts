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

export const TIMING_JUDGE_SYSTEM_PROMPT = `An X post describes an event that is live — it happened within the last few hours or is still unfolding. You decide whether a Community Note fact-check is appropriate AT ALL right now.

Raters punish notes that "correct" posts which were right (or reasonably believed) when published — a mid-match score, an early casualty figure, a deal not yet closed. People understand posts happen at a time. A note is appropriate on a live event ONLY when the post's claim was ALREADY false at the moment of posting, given what was then known — a fabricated quote, a misattributed video, a claim contradicted by evidence that existed before the post.

Return JSON:
- needs_note: boolean — true only if the claim was already false when posted AND the findings establish that with dated evidence. When the findings cannot establish what was known at posting time, needs_note = false: an unverifiable-then claim is not correctable.
- why: one short sentence.`;

export const TIMING_JUDGE_RESPONSE_FORMAT = jsonSchemaResponseFormat("timing_judge", {
  type: "object",
  properties: {
    needs_note: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["needs_note", "why"],
  additionalProperties: false,
});

export const TIMING_JUDGE_SCHEMA_HINT = '{ "needs_note": boolean, "why": string }';

/**
 * Appended to the writer system prompt ONLY when a live event passed the
 * stage-B judge — the one case where the writer must anchor its correction to
 * posting time. Evergreen notes never see this.
 */
export const WRITER_LIVE_EVENT_RULE = `

## Live event — anchor to posting time
The event this post describes was still recent or unfolding when the post was published, and the timing judge confirmed the claim was already false at that moment. Correct ONLY what was already false when the post was published, citing sources dated before or at the post's time where possible. Do not correct anything that merely changed after posting. If, while writing, you find the correction actually rests on later developments, return an empty note.`;
