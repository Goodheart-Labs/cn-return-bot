/**
 * Timing stage — Nathan's design for the time-travel problem: information,
 * not a gate.
 *
 * Runs between search and writer, only on the timing_context ON arm. One
 * extractor call answers "how close to its event was this post published?".
 * Settled-event posts (the common case) pass through untouched; fog-window
 * posts (published within LIVE_EVENT_WINDOW_HOURS of the event, or mid-event)
 * get a timing-context block piped into the writer's user message — the fact
 * plus the known regularity that true-at-posting corrections rarely rate
 * helpful. The writer's normal rules and empty-note path do the deciding.
 * Verdicts go to the tweet log (logs.timing.*). Fail-soft: any error →
 * pass-through, identical to the OFF arm.
 */

import { runJsonLlmCall } from "../utils/jsonLlmCall";
import { getTweetLog } from "../utils/tweetLog";
import {
  LIVE_EVENT_WINDOW_HOURS,
  TIMING_EXTRACTOR_SYSTEM_PROMPT,
  TIMING_EXTRACTOR_RESPONSE_FORMAT,
  TIMING_EXTRACTOR_SCHEMA_HINT,
  buildTimingContextBlock,
} from "../prompts/simple-bot/timingJudge";

// Same cheap judge model as the note-needed prefilter family.
const TIMING_MODEL = "google/gemini-3-flash-preview";

export type TimingVerdict =
  | { action: "pass" }
  | { action: "inform"; contextBlock: string };

interface ExtractorOut {
  hours_event_to_post: number | null;
  event_ongoing_at_post: boolean;
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
    log?.set("timing.hoursEventToPost", extracted.hours_event_to_post);
    log?.set("timing.eventOngoingAtPost", extracted.event_ongoing_at_post);
    log?.set("timing.extractorWhy", extracted.why);

    // Event-to-POST gap, not event-to-now: the tweet's epistemic position must
    // not depend on how long the note waited in our queue.
    const live =
      extracted.event_ongoing_at_post ||
      (extracted.hours_event_to_post !== null && extracted.hours_event_to_post <= LIVE_EVENT_WINDOW_HOURS);
    log?.set("timing.live", live);
    if (!live) return { action: "pass" };

    return {
      action: "inform",
      contextBlock: buildTimingContextBlock({
        hoursEventToPost: extracted.hours_event_to_post,
        eventOngoingAtPost: extracted.event_ongoing_at_post,
        why: extracted.why,
      }),
    };
  } catch (err) {
    // Shadow-grade robustness: a timing failure must never block a run — fall
    // back to exactly the OFF arm's behavior.
    log?.set("timing.error", String(err).slice(0, 200));
    console.warn("[timing] stage failed (passing through):", err);
    return { action: "pass" };
  }
}
