/**
 * Timing stage — Nathan's conditional design for the time-travel problem.
 *
 * Runs between search and writer, only on the time_travel_prompt ON arm:
 *   A. extractor: when did the event the post describes happen?
 *   B. judge (only when within LIVE_EVENT_WINDOW_HOURS or ongoing): given the
 *      event is live, is a fact check appropriate at all?
 *
 * Outcomes: pass-through untouched (settled event — the common case), write
 * with the live-event writer rule, or abstain. Verdicts go to the tweet log
 * (logs.timing.*) for per-arm analysis. Fail-soft: any error → pass-through,
 * identical to the OFF arm.
 */

import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { getTweetLog } from "../utils/tweetLog";
import {
  LIVE_EVENT_WINDOW_HOURS,
  TIMING_EXTRACTOR_SYSTEM_PROMPT,
  TIMING_EXTRACTOR_RESPONSE_FORMAT,
  TIMING_EXTRACTOR_SCHEMA_HINT,
  TIMING_JUDGE_SYSTEM_PROMPT,
  TIMING_JUDGE_RESPONSE_FORMAT,
  TIMING_JUDGE_SCHEMA_HINT,
} from "../prompts/simple-bot/timingJudge";

// Same cheap judge model as the note-needed prefilter family.
const TIMING_MODEL = "google/gemini-3-flash-preview";

export type TimingVerdict =
  | { action: "pass" }
  | { action: "live_write" }
  | { action: "abstain"; why: string };

interface ExtractorOut {
  hours_since_event: number | null;
  event_ongoing: boolean;
  why: string;
}

interface JudgeOut {
  needs_note: boolean;
  why: string;
}

export async function runTimingStage(params: {
  userMessage: string;
  findings: string;
}): Promise<TimingVerdict> {
  const log = getTweetLog();
  try {
    const input = `${params.userMessage}\n\n## Research findings\n\n${params.findings.slice(0, 2000)}`;

    const extracted = await runJsonLlmCall<ExtractorOut>({
      costName: "timingExtractor",
      model: TIMING_MODEL,
      messages: [
        { role: "system", content: TIMING_EXTRACTOR_SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      responseFormat: TIMING_EXTRACTOR_RESPONSE_FORMAT,
      schemaHint: TIMING_EXTRACTOR_SCHEMA_HINT,
    });
    log?.set("timing.hoursSinceEvent", extracted.hours_since_event);
    log?.set("timing.eventOngoing", extracted.event_ongoing);
    log?.set("timing.extractorWhy", extracted.why);

    const live =
      extracted.event_ongoing ||
      (extracted.hours_since_event !== null && extracted.hours_since_event <= LIVE_EVENT_WINDOW_HOURS);
    log?.set("timing.live", live);
    if (!live) return { action: "pass" };

    const judged = await runJsonLlmCall<JudgeOut>({
      costName: "timingJudge",
      model: TIMING_MODEL,
      messages: [
        { role: "system", content: TIMING_JUDGE_SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      responseFormat: TIMING_JUDGE_RESPONSE_FORMAT,
      schemaHint: TIMING_JUDGE_SCHEMA_HINT,
    });
    log?.set("timing.needsNote", judged.needs_note);
    log?.set("timing.judgeWhy", judged.why);

    return judged.needs_note ? { action: "live_write" } : { action: "abstain", why: judged.why };
  } catch (err) {
    // Shadow-grade robustness: a timing failure must never block a run — fall
    // back to exactly the OFF arm's behavior.
    log?.set("timing.error", String(err).slice(0, 200));
    console.warn("[timing] stage failed (passing through):", err);
    return { action: "pass" };
  }
}
