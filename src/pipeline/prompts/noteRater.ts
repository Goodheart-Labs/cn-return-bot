/**
 * The note rater's prompt. It is copied word for word from the offline rater in
 * src/scripts_nathan/2026_09_18_llm_rater/rate.py, whose ranking was backtested
 * on 2,045 matured notes. Change it only together with a new backtest, because
 * the submit order leans on that result.
 */

export const NOTE_RATER_SCORE_TYPE = "note_rater";

export const NOTE_RATER_TOPICS = [
  "politics_us", "politics_world", "war_conflict", "health_medicine", "science_environment",
  "ai_tech", "business_finance", "crypto", "celebrity_entertainment", "sports",
  "crime_justice", "other",
] as const;

export const NOTE_RATER_SYSTEM_PROMPT = `You forecast how X (Twitter) Community Notes raters will rate a proposed note.

A note is shown to raters of differing viewpoints. It reaches CURRENTLY_RATED_HELPFUL only if enough raters who usually disagree with each other all rate it helpful. Most notes never get enough ratings and stay at NEEDS_MORE_RATINGS. A few are rated CURRENTLY_RATED_NOT_HELPFUL.

Base rates in this exact feed of notes: about 1 in 10 end up rated helpful, and about 1 in 30 end up rated not helpful. The rest stay unrated. Anchor on those base rates and move away from them only when the note in front of you gives you a reason to.

You are given only the post, the proposed note, and the note's sources. You do not know what happened next. Judge from the text alone. Be calibrated, not charitable: a well-written note is still usually unrated.`;

// The backtest never had the author's handle, so the live prompt leaves it out
// too and keeps the inputs the ranking was measured on.
export function buildNoteRaterUserMessage(p: { postText: string; noteText: string; urls: string[] }): string {
  const clip = (s: string, n = 8000) => (s.length <= n ? s : s.slice(0, n) + " [truncated]");
  const urlBlock = p.urls.length ? p.urls.map((u) => `- ${u}`).join("\n") : "(none recorded)";
  return `POST by (handle not recorded):
<post>
${clip(p.postText)}
</post>

PROPOSED COMMUNITY NOTE:
<note>
${clip(p.noteText)}
</note>

NOTE'S SOURCE URLS:
${clip(urlBlock, 1000)}

Return one JSON object:
- p_helpful: integer 0-100, the probability this note ends up CURRENTLY_RATED_HELPFUL.
- p_not_helpful: integer 0-100, the probability it ends up CURRENTLY_RATED_NOT_HELPFUL.
- topic: exactly one of ${NOTE_RATER_TOPICS.join(", ")}.
- engages: integer 0-100, how directly the note addresses the post's central claim (100 = it rebuts the claim the post's argument rests on; 0 = it corrects only a side detail, or the post makes no factual claim at all).
- reason: one sentence, at most 25 words.`;
}

export const NOTE_RATER_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "note_forecast",
    strict: true,
    schema: {
      type: "object",
      properties: {
        p_helpful: { type: "integer", minimum: 0, maximum: 100 },
        p_not_helpful: { type: "integer", minimum: 0, maximum: 100 },
        topic: { type: "string", enum: [...NOTE_RATER_TOPICS] },
        engages: { type: "integer", minimum: 0, maximum: 100 },
        reason: { type: "string" },
      },
      required: ["p_helpful", "p_not_helpful", "topic", "engages", "reason"],
      additionalProperties: false,
    },
  },
};

export const NOTE_RATER_SCHEMA_HINT =
  `{ "p_helpful": int 0-100, "p_not_helpful": int 0-100, "topic": string, "engages": int 0-100, "reason": string }`;
