/**
 * Note-writer step log keys.
 *
 * The note-writing pipeline and the note-needed prefilter record their per-step
 * logs under a single `note_writer_steps` namespace. That way the review
 * dashboard renders one foldable tree with the same step names no matter which
 * bot ran. The steps both bots share are note_writer, note_needed_judge and
 * source_verifier. Those log under the same key from one shared module.
 *
 * The same leaf keys drive cost tracking. Every LLM call's cost name starts
 * with its step leaf, which is listed in COST below. Costs are grouped by the
 * first segment of the name, so `costs.groups` lines up one to one with the
 * step tree.
 */

const ROOT = "note_writer_steps";

/** Cost-tracker name prefix per step. This is the first segment of every LLM
 *  call's cost name, so the keys of `costs.groups` match the note_writer_steps
 *  step names. */
export const COST = {
  satireDetector: "satire_detector",
  queryWriter: "query_writer",
  searchAnalyzer: "search_analyzer",
  search: "search",
  noteWriter: "note_writer",
  noteNeededJudge: "note_needed_judge",
  sourceVerifier: "source_verifier",
} as const;

/** Log and display key per step. Each one is nested under `note_writer_steps`
 *  in the tweet log. */
export const STEP = {
  root: ROOT,
  satireDetector: `${ROOT}.${COST.satireDetector}`,
  queryWriter: `${ROOT}.${COST.queryWriter}`,
  fetchAndFormatSearch: `${ROOT}.fetch_and_format_search`,
  searchAnalyzer: `${ROOT}.${COST.searchAnalyzer}`,
  search: `${ROOT}.${COST.search}`,
  noteWriter: `${ROOT}.${COST.noteWriter}`,
  noteNeededJudge: `${ROOT}.${COST.noteNeededJudge}`,
  sourceVerifier: `${ROOT}.${COST.sourceVerifier}`,
} as const;

/** Cap on the research-brief text logged under search_analyzer.messages.1. A
 *  long free-text brief would otherwise bloat the pipeline_runs JSONB column. */
export const ANALYSIS_LOG_MAX_CHARS = 4000;
