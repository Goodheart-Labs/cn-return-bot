/**
 * Note-writer step log keys
 *
 * Both note-writing pipelines (simple-bot and cheap-bot) record their per-step
 * logs under a single `note_writer_steps` namespace so the review dashboard can
 * render one foldable tree with the same step names regardless of which bot ran.
 * Steps shared by both bots (note_writer, note_needed_judge, source_verifier)
 * log under the same key from one shared module.
 *
 * The same leaf keys drive cost tracking: each LLM call's cost name starts with
 * its step leaf (COST below), so `costs.groups` (grouped by the first name
 * segment) lines up 1:1 with the step tree.
 */

const ROOT = "note_writer_steps";

/** Cost-tracker name prefix per step — the first segment of every LLM call's
 *  cost name, so `costs.groups` keys match the note_writer_steps step names. */
export const COST = {
  satireDetector: "satire_detector",
  queryWriter: "query_writer",
  searchAnalyzer: "search_analyzer",
  search: "search",
  correctionExtractor: "correction_extractor",
  noteWriter: "note_writer",
  noteNeededJudge: "note_needed_judge",
  sourceVerifier: "source_verifier",
} as const;

/** Log/display key per step — nested under `note_writer_steps` in the tweet log. */
export const STEP = {
  root: ROOT,
  satireDetector: `${ROOT}.${COST.satireDetector}`,
  queryWriter: `${ROOT}.${COST.queryWriter}`,
  fetchAndFormatSearch: `${ROOT}.fetch_and_format_search`,
  searchAnalyzer: `${ROOT}.${COST.searchAnalyzer}`,
  search: `${ROOT}.${COST.search}`,
  correctionExtractor: `${ROOT}.${COST.correctionExtractor}`,
  noteWriter: `${ROOT}.${COST.noteWriter}`,
  noteNeededJudge: `${ROOT}.${COST.noteNeededJudge}`,
  sourceVerifier: `${ROOT}.${COST.sourceVerifier}`,
} as const;

/** Cap on the research-brief text logged under search_analyzer.messages.1, so a
 *  long free-text brief can't bloat the pipeline_runs JSONB. */
export const ANALYSIS_LOG_MAX_CHARS = 4000;
