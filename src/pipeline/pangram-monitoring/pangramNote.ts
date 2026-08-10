/**
 * The fixed Community Note we submit when Pangram flags a post as AI-generated.
 *
 * There are two A/B variants, see PANGRAM_NOTE_TEST. The `plain` variant is the
 * verdict and the Pangram report link and nothing more. The `fp_context` variant
 * also reassures the reader about how rarely Pangram is wrong, and it backs that
 * up with two more sources. X requires every note to carry a source, and the
 * report link is what serves as one here.
 */
import { countSubmittedNoteLength, joinNoteWithSources } from "../utils/noteLength";

const NOTE_BODY_PLAIN = "According to Pangram this post is AI generated";
const NOTE_BODY_FP =
  "According to Pangram this post is AI generated. Pangram has a false positive rate far below 1%";

// These sources back up the false-positive claim the fp_context variant makes.
// They are appended after the Pangram report link.
const FALSE_POSITIVE_SOURCES = [
  "http://chicagobooth.edu/review/do-ai-detectors-work-well-enough-trust",
  "https://www.pangram.com/blog/all-about-false-positives-in-ai-detectors",
];

// X caps a note at 280 characters and counts every URL as a single character.
// Both variants sit well under that today. The check exists so a later change to
// the wording cannot quietly ship a note that is too long.
const MAX_NOTE_LENGTH = 280;

export type PangramNoteVariant = "plain" | "fp_context";
export type PangramNote = { noteText: string; sourceUrl: string };

/** Returns the note as it would be submitted, which is the body followed by its
 *  source links. It returns null when that note would be over the length limit. */
export function buildPangramNote(dashboardLink: string, variant: PangramNoteVariant): PangramNote | null {
  if (!dashboardLink) return null;
  const body = variant === "fp_context" ? NOTE_BODY_FP : NOTE_BODY_PLAIN;
  const sources = variant === "fp_context" ? [dashboardLink, ...FALSE_POSITIVE_SOURCES] : [dashboardLink];
  if (countSubmittedNoteLength(body, sources) > MAX_NOTE_LENGTH) return null;
  return { noteText: joinNoteWithSources(body, sources), sourceUrl: sources.join(" ") };
}
