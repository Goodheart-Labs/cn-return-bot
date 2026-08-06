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
  event_time_utc: string | null;
  why: string;
}

export async function runTimingStage(params: {
  userMessage: string;
  findings: string;
  /** post.created_at — the other operand of the gap; the model only names the
   *  event's time, the subtraction happens here. */
  postCreatedAt: string;
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
    log?.set("timing.eventTimeUtc", extracted.event_time_utc);
    log?.set("timing.extractorWhy", extracted.why);

    // The model names the event time; the gap is OUR arithmetic. Event-to-POST,
    // not event-to-now: the tweet's epistemic position must not depend on how
    // long the note waited in our queue. Signed gap logged (negative = the post
    // predates its event, e.g. announcements) — observable, not yet triggering.
    let gapHours: number | null = null;
    if (extracted.event_time_utc) {
      const eventMs = Date.parse(extracted.event_time_utc);
      const postMs = Date.parse(params.postCreatedAt);
      if (Number.isFinite(eventMs) && Number.isFinite(postMs)) {
        gapHours = (postMs - eventMs) / 3_600_000;
      }
    }
    log?.set("timing.hoursEventToPost", gapHours);

    const live = gapHours !== null && gapHours >= 0 && gapHours <= LIVE_EVENT_WINDOW_HOURS;
    log?.set("timing.live", live);
    if (!live) return { action: "pass" };

    return {
      action: "inform",
      contextBlock: buildTimingContextBlock({ hoursEventToPost: gapHours! }),
    };
  } catch (err) {
    // Shadow-grade robustness: a timing failure must never block a run — fall
    // back to exactly the OFF arm's behavior.
    log?.set("timing.error", String(err).slice(0, 200));
    console.warn("[timing] stage failed (passing through):", err);
    return { action: "pass" };
  }
}
