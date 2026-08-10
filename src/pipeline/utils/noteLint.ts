/**
 * Lint rules for the writer's output. The length rule applies to every note. The
 * stricter shape rules cover how many sources a note cites, the form of each
 * source URL, and bare-domain citations. Those rules apply to curated-topic notes
 * only. The rubric scoring of the election-topic notes on 22 July 2026 showed
 * that the winning notes carry one or two clickable primary URLs, while our
 * failures carried three or four or cited bare domains. This module has no side
 * effects, so the rules can be unit tested without running the LLM retry loop.
 */

import { countSubmittedNoteLength } from "./noteLength";
import { getMonitoringContext } from "../misinfo-monitoring/monitoringContext";

/** A topic note cites one or two sources and never more. The rubric items s4 and
 *  f5 are the evidence for this limit. */
export const MAX_TOPIC_SOURCES = 2;

export interface LintProblem {
  kind: "length" | "source_count" | "source_url" | "bare_domain";
  message: string;
}

/**
 * Matches a bare-domain citation inside the note body, for example
 * `foxnews.com/politics/...`, which has a path but no scheme. Such a citation is
 * not clickable once the note is published. URLs that do carry a scheme are
 * stripped before this pattern runs, so only scheme-less tokens with a domain and
 * a path can match. The path is required on purpose. Plain prose like "the
 * FactCheck.org article" is a matter for the sourcing rule and not for this lint.
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
 * Validates a writer response. Setting `topicRules` turns on the curated-topic
 * shape checks. With it off only the length rule runs, which is what the regular
 * pipeline has always done. An empty note has no text and no sources. That is the
 * legitimate "no dispute found" outcome, so it is never linted.
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
 * Guards the step that runs after verification. A curated-topic note must ship
 * with at least one source. The classic verifier, the one that does not work
 * claim by claim, can accept a note while classifying every cited URL as bad.
 * That would publish the note with no sources at all. Every note on this topic
 * that ever reached Helpful carries a URL. The live `verifier_claim_based` A/B
 * test sends about half of the monitored posts down that classic path, so this
 * case really does happen. Both bot orchestrators call this function, so
 * re-weighting a bot later cannot bypass it. Returns the reason to reject the
 * note, or null when the note is fine.
 */
export function topicSourcelessRejection(goodSources: string[]): string | null {
  if (goodSources.length > 0 || getMonitoringContext() === undefined) return null;
  return "curated-topic note has no verified sources left after verification; a sourceless note cannot reach Helpful on this topic";
}
