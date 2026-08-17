/**
 * The timing stage. This is Nathan's design for the time-travel problem. It
 * gives the writer information rather than acting as a gate.
 *
 * It runs between the search and the writer, and only on the timing_context ON
 * arm. One extractor call answers a single question. How close to its event was
 * this post published? A post about an event that has already settled is the
 * common case, and it passes through untouched. A post published within
 * LIVE_EVENT_WINDOW_HOURS of its event, or in the middle of the event, gets a
 * block of timing context added to the writer's user message. That block states
 * the gap, and it reminds the writer that a correction which was true at the
 * moment of posting rarely rates helpful. The writer's normal rules and its
 * empty-note path do the actual deciding.
 *
 * Every verdict is written to the tweet log under logs.timing. The stage fails
 * soft. Any error makes it pass the post through, exactly as the OFF arm does.
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
  /** The value of post.created_at. It is the second operand of the gap. The
   *  model only names the event's time. The subtraction happens here. */
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

    // The model names the event time. We do the arithmetic ourselves. The gap
    // runs from the event to the post, not from the event to now. What the
    // author could have known must not depend on how long the post waited in
    // our queue. We log the gap with its sign. A negative gap means the post
    // came before its event, which happens with announcements. We only record
    // that case for now. It does not trigger anything.
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
      contextBlock: buildTimingContextBlock({ hoursEventToPost: gapHours!, why: extracted.why }),
    };
  } catch (err) {
    // A failure in this stage must never block a run. We fall back to exactly
    // the behaviour of the OFF arm.
    log?.set("timing.error", String(err).slice(0, 200));
    console.warn("[timing] stage failed (passing through):", err);
    return { action: "pass" };
  }
}
