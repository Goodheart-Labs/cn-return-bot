/**
 * The fixed Community Note we submit when Pangram flags a post as AI-generated.
 * Two A/B variants (see PANGRAM_NOTE_TEST): `plain` is just the verdict + the
 * Pangram report link; `fp_context` adds a false-positive-rate reassurance and
 * two supporting sources. The report URL doubles as the note's (required) source.
 */
import { countSubmittedNoteLength, joinNoteWithSources } from "../utils/noteLength";

const NOTE_BODY_PLAIN = "According to Pangram this post is AI generated";
const NOTE_BODY_FP =
  "According to Pangram this post is AI generated. Pangram has a false positive rate far below 1%";

// Supporting sources for the fp_context variant (appended after the report link).
const FALSE_POSITIVE_SOURCES = [
  "http://chicagobooth.edu/review/do-ai-detectors-work-well-enough-trust",
  "https://www.pangram.com/blog/all-about-false-positives-in-ai-detectors",
];

// X caps notes at 280 chars; URLs count as 1. Both variants are well under, but
// guard so a future wording change can't silently ship an over-limit note.
const MAX_NOTE_LENGTH = 280;

export type PangramNoteVariant = "plain" | "fp_context";
export type PangramNote = { noteText: string; sourceUrl: string };

/** Returns the submitted note (body + source links) or null if it would exceed the limit. */
export function buildPangramNote(dashboardLink: string, variant: PangramNoteVariant): PangramNote | null {
  if (!dashboardLink) return null;
  const body = variant === "fp_context" ? NOTE_BODY_FP : NOTE_BODY_PLAIN;
  const sources = variant === "fp_context" ? [dashboardLink, ...FALSE_POSITIVE_SOURCES] : [dashboardLink];
  if (countSubmittedNoteLength(body, sources) > MAX_NOTE_LENGTH) return null;
  return { noteText: joinNoteWithSources(body, sources), sourceUrl: sources.join(" ") };
}
