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

/** Events younger than this (or still ongoing) get the stage-B judge. */
export const LIVE_EVENT_WINDOW_HOURS = 6;

export const TIMING_EXTRACTOR_SYSTEM_PROMPT = `You read an X post and research findings about it, and answer one narrow question: WHEN did the event the post describes actually happen?

Return JSON:
- hours_since_event: number | null — hours between the event and now (the user message states the current date/time). null when the post is not about a datable event (evergreen claims, old photos resurfacing, general statistics).
- event_ongoing: boolean — true when the event is still actively developing right now (match in progress, ongoing search/rescue, live negotiation, unresolved breaking story).
- why: one short sentence.

Date the EVENT, not the post: an old video reposted today is an old event. A post claiming a death, score, transfer, or ruling that reportedly happened today is a recent event even if the claim is false — date what the claim is about.`;

export const TIMING_EXTRACTOR_RESPONSE_FORMAT = jsonSchemaResponseFormat("timing_extractor", {
  type: "object",
  properties: {
    hours_since_event: { type: ["number", "null"] },
    event_ongoing: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["hours_since_event", "event_ongoing", "why"],
  additionalProperties: false,
});

export const TIMING_EXTRACTOR_SCHEMA_HINT =
  '{ "hours_since_event": number | null, "event_ongoing": boolean, "why": string }';

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
