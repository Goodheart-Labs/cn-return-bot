/**
 * Note-writer step log keys
 *
 * Both note-writing pipelines (simple-bot and cheap-bot) record their per-step
 * logs under a single `note_writer_steps` namespace so the review dashboard can
 * render one foldable tree with the same step names regardless of which bot ran.
 * Steps shared by both bots (note_writer, note_needed_judge, source_verifier)
 * log under the same key from one shared module.
 *
 * These are LOG/display keys only — cost-tracking names (the first arg to
 * trackedLlmCreate) are a separate concern and stay grouped by subsystem.
 */

const ROOT = "note_writer_steps";

export const STEP = {
  root: ROOT,
  satireDetector: `${ROOT}.satire_detector`,
  queryWriter: `${ROOT}.query_writer`,
  fetchAndFormatSearch: `${ROOT}.fetch_and_format_search`,
  searchAnalyzer: `${ROOT}.search_analyzer`,
  search: `${ROOT}.search`,
  noteWriter: `${ROOT}.note_writer`,
  noteNeededJudge: `${ROOT}.note_needed_judge`,
  sourceVerifier: `${ROOT}.source_verifier`,
} as const;

/** Cap on the research-brief text logged under search_analyzer.messages.1, so a
 *  long free-text brief can't bloat the pipeline_runs JSONB. */
export const ANALYSIS_LOG_MAX_CHARS = 4000;
