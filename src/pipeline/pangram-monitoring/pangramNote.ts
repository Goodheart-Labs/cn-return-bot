/**
 * The fixed Community Note we submit when Pangram flags a post as AI-generated
 * and the Claude judge expects the note to be rated helpful (GOO-880).
 *
 * There are two A/B variants, see PANGRAM_NOTE_TEST. The `plain` variant is the
 * verdict and the Pangram report link and nothing more. The `fp_context` variant
 * also reassures the reader about how rarely Pangram is wrong, and it backs that
 * up with one more source. X requires every note to carry a source, and the
 * report link is what serves as one here.
 */
import { countSubmittedNoteLength, joinNoteWithSources } from "../utils/noteLength";

const NOTE_BODY_PLAIN = "According to Pangram this post is AI generated";
const NOTE_BODY_FP =
  "According to Pangram this post is AI generated. Pangram has a false positive rate far below 1%";

// The source for the false-positive claim the fp_context variant makes. It is
// appended after the Pangram report link. Jim picked it on 2026-11-25 because
// it sums up many studies. Until then the variant cited a Chicago Booth Review
// article and Pangram's own blog. The part after # is a text fragment: browsers
// that support it scroll to and highlight the passage on the studies. It ends
// without the passage's full stop, because X would cut a trailing full stop
// off the link.
const FALSE_POSITIVE_SOURCES = ["https://benthams.substack.com/p/pangram-works-deal-with-it#:~:text=Other%20reviews%20find,various%20other%20studies"];

// X caps a note at 280 characters and counts every URL as a single character.
// Both variants sit well under that today. The check exists so a later change to
// the wording cannot quietly ship a note that is too long.
const MAX_NOTE_LENGTH = 280;

/** The outcome_reason of a Pangram note the judge approved, which waits for
 *  the first account's writer to submit it (src/x-notes/writer.ts). */
export const PANGRAM_APPROVED = "pangram_approved";
/** X has no tag for AI-generated content. Missing context is the closest fit,
 *  because the post does not disclose that it was written by an AI. */
export const PANGRAM_MISLEADING_TAGS = ["missing_important_context"];
/** The status the July 2026 pre-pass gave its notes, kept for the dashboards. */
export const PANGRAM_NOTE_STATUS = "AI_GENERATED";

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
