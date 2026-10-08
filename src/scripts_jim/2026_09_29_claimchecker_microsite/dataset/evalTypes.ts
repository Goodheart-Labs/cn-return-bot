/**
 * The shapes the eval runner reads and writes: the rows of dataset.json that the
 * evals use, and the result file of one run. The artifact page reads the result
 * files too, so this file holds types and nothing else.
 */
import type { Group } from "./datapoints";

/** The parts of a dataset.json row that the evals read. */
export interface DatasetRow {
  id: string;
  group: Group;
  referenceClaim: string;
  expected: { decision: "note" | "no_note"; noteTolerated?: boolean; referenceNote?: string };
  item: { id: string; title: string };
  extractor: { highlight: { start: number; end: number } | null; userMessage: string };
  checker: {
    claim: { restatement: string; contextQuote: string | null; imageUrls: string[] };
    post: { id: string; author_id: string; created_at: string; text: string; media: { type: string; url: string }[] };
  };
  production: { notes: { text: string; writtenBy: string; votes: { helpful: number; somewhatHelpful: number; notHelpful: number } }[] };
}

export type EvalName = "extractor" | "checker";

export interface JudgeAnswer {
  found: boolean;
  matchingClaims: number[];
  reason: string;
}

export interface ExtractedClaimSummary {
  claim: string;
  context: string;
  imageUrls: string[];
}

/** One call of the extractor on one chunk. A failed call has an error and no claims. */
export interface ChunkSample {
  claims: ExtractedClaimSummary[];
  /** How many claims the extractor flagged as speculation. The pipeline drops them, so the judge never sees them. */
  speculationDropped: number;
  costUsd: number;
  error?: string;
}

export interface ChunkRun {
  key: string;
  itemTitle: string;
  chunkIndex: number;
  chunkCount: number;
  chunkChars: number;
  samples: ChunkSample[];
}

export interface ExtractorRowResult {
  id: string;
  group: Group;
  referenceClaim: string;
  passage: string;
  chunkKey: string;
  /** The judge's answer per sample. A sample whose extraction failed has none. */
  judgements: (JudgeAnswer | null)[];
  foundIn: number;
  passed: boolean;
}

export interface ExtractorEvalResult {
  samples: number;
  passAt: number;
  rows: ExtractorRowResult[];
  chunkRuns: ChunkRun[];
  costUsd: { extraction: number; judge: number };
}

export type CheckerOutcome =
  | { type: "note"; note: string; sources: { url: string; quote: string | null; explanation: string | null }[] }
  | { type: "no_note"; reason: string }
  | { type: "error"; error: string };

/** pass and fail compare the decision with the expected one. A soft fail is a
 *  note where Jim said a note would not be bad. An error is counted apart. */
export type CheckerVerdict = "pass" | "fail" | "soft_fail" | "error";

export interface QualityAnswer {
  samePoint: boolean;
  reason: string;
}

/** The user messages that were sent to two steps of one claim check, as the
 *  pipeline built them: the date lines, the post and the replies fetched for it. */
export interface CheckerPrompts {
  research: string | null;
  writer: string | null;
}

/** One run of the whole claim check on one row. */
export interface CheckerSample {
  outcome: CheckerOutcome;
  /** Missing in a run saved before the prompts were kept and not yet filled in from its logs. */
  prompts?: CheckerPrompts;
  verdict: CheckerVerdict;
  /** Only for a note where reference notes exist. */
  quality: QualityAnswer | null;
  research: string | null;
  draftNote: string | null;
  sourceVerdict: string | null;
  checkCostUsd: number;
  judgeCostUsd: number;
}

export interface CheckerRowResult {
  id: string;
  group: Group;
  expected: DatasetRow["expected"];
  referenceNotes: string[];
  samples: CheckerSample[];
  /** In how many samples the decision was the expected one. */
  passedIn: number;
  /** The row's verdict over its samples: a pass when passedIn reaches the pass mark,
   *  otherwise the most common way the samples went wrong. */
  verdict: CheckerVerdict;
}

export interface CheckerEvalResult {
  samples: number;
  passAt: number;
  rows: CheckerRowResult[];
  costUsd: { checks: number; judge: number };
}

export interface EvalRun {
  id: string;
  label: string;
  createdAt: string;
  commit: string;
  settings: { extractorModel: string; checkerModels: string; commentsFetched: boolean; samples: { extractor: number; checker: number } };
  /** The rows the run covered, by id. */
  rowIds: string[];
  extractor: ExtractorEvalResult | null;
  checker: CheckerEvalResult | null;
}
