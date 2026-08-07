/**
 * Writer-output lint. The length rule applies to every note; the stricter
 * shape rules (source count, URL form, no bare-domain citations) apply only to
 * curated-topic notes — the 7/22 rubric scoring of the election-topic notes
 * showed winners carry 1-2 clickable primary URLs while our failures carried
 * 3-4 or cited bare domains. Pure module so the rules are unit-testable
 * without the LLM retry loop.
 */

import { countSubmittedNoteLength } from "./noteLength";
import { getMonitoringContext } from "../misinfo-monitoring/monitoringContext";

/** Topic notes cite one or two sources — never more (rubric s4/f5). */
export const MAX_TOPIC_SOURCES = 2;

export interface LintProblem {
  kind: "length" | "source_count" | "source_url" | "bare_domain";
  message: string;
}

/**
 * Bare-domain citation inside the note body: `foxnews.com/politics/...` with a
 * path but no scheme — unclickable once the note is published. Scheme-ful URLs
 * are stripped first, so only scheme-less domain+path tokens match. A path
 * segment is required: plain prose like "the FactCheck.org article" is the
 * sourcing rule's business, not the lint's.
 */
const BARE_DOMAIN_RE = /(?:^|[\s("'“])((?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s"')”]+)/i;

function findBareDomain(noteText: string): string | null {
  const withoutUrls = noteText.replace(/https?:\/\/\S+/g, " ");
  const m = withoutUrls.match(BARE_DOMAIN_RE);
  return m ? m[1]! : null;
}

function isFullHttpsUrl(source: string): boolean {
  try {
    return new URL(source).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate a writer response. `topicRules` turns on the curated-topic shape
 * checks; with it off, only the length rule runs (regular-pipeline behavior,
 * unchanged). The empty note (`note_text` "" + no sources) is the legitimate
 * "no dispute found" outcome and is never linted.
 */
export function lintWriterNote(opts: {
  noteText: string;
  sources: string[];
  maxChars: number;
  topicRules: boolean;
}): { charCount: number; problems: LintProblem[] } {
  const { noteText, sources, maxChars, topicRules } = opts;
  const charCount = countSubmittedNoteLength(noteText, sources);
  if (noteText.trim() === "" && sources.length === 0) {
    return { charCount, problems: [] };
  }

  const problems: LintProblem[] = [];
  if (charCount > maxChars) {
    problems.push({
      kind: "length",
      message: `the note is ${charCount} chars incl. sources (URLs count as one char); the limit is ${maxChars}`,
    });
  }
  if (!topicRules) return { charCount, problems };

  if (sources.length > MAX_TOPIC_SOURCES) {
    problems.push({
      kind: "source_count",
      message: `the note cites ${sources.length} sources; cite at most ${MAX_TOPIC_SOURCES} — keep the ones that most directly support the correction`,
    });
  }
  for (const source of sources) {
    if (!isFullHttpsUrl(source)) {
      problems.push({
        kind: "source_url",
        message: `source "${source}" is not a full https:// URL`,
      });
    }
  }
  const bare = findBareDomain(noteText);
  if (bare) {
    problems.push({
      kind: "bare_domain",
      message: `the note body cites "${bare}" as a bare domain — it will not be clickable; cite it as a full https:// URL in sources instead`,
    });
  }
  return { charCount, problems };
}

/**
 * Post-verification guard: a curated-topic note must ship with at least one
 * source. The classic (non-claim-based) verifier can accept a note while
 * classifying every cited URL as bad, publishing it with zero sources — and
 * every historical Helpful note on this topic carries a URL. Reachable for
 * ~half of monitored posts via the live verifier_claim_based A/B, and called
 * from BOTH bot orchestrators so a future bot re-weight cannot bypass it.
 * Returns the rejection reason, or null when the note is fine.
 */
export function topicSourcelessRejection(goodSources: string[]): string | null {
  if (goodSources.length > 0 || getMonitoringContext() === undefined) return null;
  return "curated-topic note has no verified sources left after verification; a sourceless note cannot reach Helpful on this topic";
}
