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
  /** The atomic statements the extractor has to produce. */
  referenceClaims: string[];
  /** True for a datapoint that only the extractor eval uses. It has no expected decision, checker input or production result. */
  extractorOnly: boolean;
  /** Set on a whole post without labels. The extractor eval reads all its chunks and shows the passages by hand. It has no reference statements and is not part of the checker eval. */
  unlabelled?: { chunks: string[]; productionClaims: number };
  /** True for a datapoint that only the checker eval uses. It has no extractor input. */
  checkerOnly?: boolean;
  /** True for a tweet on which our X notewriter wrote a helpful note. Both evals run it with the X prompts, and the claim checker eval runs it through the X bot's pipeline. */
  xPost?: boolean;
  expected: { decision: "note" | "no_note"; noteTolerated?: boolean; referenceNote?: string } | null;
  item: { id: string; title: string };
  extractor: { chunkIndex: number; chunkCount: number; chunkChars: number; highlight: { start: number; end: number } | null; userMessage: string } | null;
  checker: {
    claim: { restatement: string; contextQuote: string | null; imageUrls: string[] };
    post: { id: string; author_id: string; created_at: string; text: string; media: { type: string; url: string }[] };
  } | null;
  production: { notes: { text: string; writtenBy: string; votes: { helpful: number; somewhatHelpful: number; notHelpful: number } }[] } | null;
}

/** A row that the extractor eval can run: it has an extractor input. */
export type ExtractableRow = DatasetRow & { extractor: NonNullable<DatasetRow["extractor"]> };
export const isExtractable = (row: DatasetRow): row is ExtractableRow => !row.checkerOnly && !row.unlabelled;
export type UnlabelledRow = DatasetRow & { unlabelled: NonNullable<DatasetRow["unlabelled"]> };
export const isUnlabelled = (row: DatasetRow): row is UnlabelledRow => !!row.unlabelled;

/** A row that the claim checker eval can run: it has a checker input and an expected decision. */
export type CheckableRow = DatasetRow & { checker: NonNullable<DatasetRow["checker"]>; expected: NonNullable<DatasetRow["expected"]>; production: NonNullable<DatasetRow["production"]> };
export const isCheckable = (row: DatasetRow): row is CheckableRow => !row.extractorOnly && !row.unlabelled;

export type EvalName = "extractor" | "checker" | "probability";

export interface JudgeAnswer {
  found: boolean;
  /** Whether every matching claim states a single statement. Missing in a run made before the judge asked. */
  atomic?: boolean;
  matchingClaims: number[];
  reason: string;
}

export interface ExtractedClaimSummary {
  claim: string;
  context: string;
  imageUrls: string[];
}

/** A passage the extractor cut out of a chunk, sorted as a statement, a forecast or other. */
export interface PassageSummary {
  text: string;
  type: string;
  /** What an "other" passage is, in the model's words. */
  why?: string;
  claims: string[];
}

/** One call of the extractor on one chunk. A failed call has an error and no claims. */
export interface ChunkSample {
  claims: ExtractedClaimSummary[];
  /** Missing in a run made before the passage format. */
  passages?: PassageSummary[];
  /** The share of the chunk's characters that the passages cover. */
  coverage?: number;
  /** How many answers the extractor needed to give passages that add up to the chunk. */
  attempts?: number;
  /** How many claims the extractor flagged as speculation, in a run made before the passage format. The pipeline dropped them, so the judge never saw them. */
  speculationDropped?: number;
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

/** One statement the extractor has to produce, with the result for it. Rows of
 *  one datapoint share its chunk. */
export interface ExtractorRowResult {
  /** The datapoint's id, followed by # and the statement's number when the datapoint has several. */
  id: string;
  /** Missing in a run made before a datapoint could have several statements, where the id is the datapoint's. */
  datapointId?: string;
  group: Group;
  referenceClaim: string;
  passage: string;
  chunkKey: string;
  /** The judge's answer per sample. A sample whose extraction failed has none. */
  judgements: (JudgeAnswer | null)[];
  foundIn: number;
  /** In how many samples the statement was found and every matching claim was atomic. Missing in a run made before the judge asked. */
  atomicIn?: number;
  passed: boolean;
}

/** What the extractor made of every chunk of an unlabelled post, one sample per chunk. */
export interface UnlabelledPostResult {
  id: string;
  title: string;
  url: string | null;
  /** How many claims production extracted and checked from the post. */
  productionClaims: number;
  chunks: { chunkIndex: number; chunkChars: number; passages: PassageSummary[]; error: string | null }[];
  costUsd: number;
}

export interface ExtractorEvalResult {
  samples: number;
  /** Missing in a run made before the unlabelled posts. */
  unlabelled?: UnlabelledPostResult[];
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

/** The first step of the cascading search: the cheap model's probability, what the cascade did with it, and the findings. */
export interface CascadeTrace {
  probability: number;
  /** note: straight to the writer. no_note: the check ended. escalate: the stronger model researched. audit: escalated although the probability was low. */
  decision: "note" | "no_note" | "escalate" | "audit";
  answeredBy: string;
  findings: string | null;
  userMessage: string | null;
}

/** One run of the source verifier on a note: what it was given and what it answered. The second round has a second one. */
export interface SourceCheckTrace {
  turn: number;
  /** The log file that holds the full run of the verifier, with the user message it was given: the note and the pages fetched for its sources. The page loads it on demand, because those pages are large. */
  logFile: string | null;
  /** The verifier's answer as it was logged. Null when the verifier was not called. */
  output: {
    accepted: boolean;
    reasoning: string;
    good_sources: string[];
    bad_sources: string[];
    source_evaluations?: { url: string; verdict: "good" | "bad"; citations: { quote: string; explanation: string }[] }[];
  } | null;
  /** Whether each cited source could be opened. */
  fetches: { url: string; fetched: boolean; whatCameBack?: string }[] | null;
  /** Set when the verifier was not called, with the reason and the text of the sources as fetched. */
  notRun: { reason: string; sources_as_fetched: string } | null;
}

/** What the second research round did, when a run on the second_round arm had its note rejected by the source verifier. */
export interface SecondRoundTrace {
  /** The outcome of the second round: note, verification_failed, research_withdrew, writer_empty or unfetchable_sources. */
  result: string;
  /** The first note and what the verifier said about it. The sources are missing in a run made before they were kept. */
  first: { findings: string; note: string; sources?: string[]; reasoning: string };
  revisedFindings: string;
  /** What the second round wrote and what became of it. Missing in a run saved before it was kept. */
  second?: {
    note: string;
    sources: string[];
    /** Why the second source check did not run: the fetch error, when none of the revised sources could be opened. */
    error: string | null;
    /** What the second source check said, when it ran. */
    verifierReasoning: string | null;
    /** Whether each revised source could be opened. Missing when the log did not keep it. */
    fetches: { url: string; fetched: boolean; whatCameBack?: string }[] | null;
  };
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
  /** The models that ran the full research, the writer and the source verifier. The research is null when the check never reached it. Missing in a run made before they were kept. */
  models?: { search: string | null; writer: string | null; verifier: string | null };
  /** Missing in a run made before the second round, and null when the verifier did not reject the first note. */
  secondRound?: SecondRoundTrace | null;
  /** What the cascade's quick research said. Missing in a run made before the cascade, and null on the precheck path. */
  cascade?: CascadeTrace | null;
  /** The probability the stronger model gave, in a run made when it answered with one. Missing in a run saved before it was kept. */
  strongProbability?: number | null;
  /** Whether the stronger model said the claim is misleading, in a run made when it answered yes or no. Missing in an earlier run. */
  strongMisleading?: boolean | null;
  draftNote: string | null;
  /** Where the full logs of the check are published, relative to the page. A rerun from the writer on has the log of the research and the log of the rerun. */
  logFiles?: string[];
  /** Every run of the source verifier in the check. Missing in a run saved before they were kept. */
  sourceChecks?: SourceCheckTrace[];
  /** The source addresses of the drafted note. Missing in a run saved before they were kept. */
  draftSources?: string[];
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

/** One ask of the research step for its probability that the claim is misleading. */
export interface ProbabilitySample {
  /** Null when the call failed. */
  probability: number | null;
  /** The user message of the research step. Missing in a run made before it was kept. */
  userMessage?: string;
  findings: string | null;
  costUsd: number;
  error?: string;
}

export interface ProbabilityRowResult {
  id: string;
  group: Group;
  expected: DatasetRow["expected"];
  samples: ProbabilitySample[];
}

export interface ProbabilityEvalResult {
  samples: number;
  /** The research system prompt that was used. */
  prompt: string;
  /** The research prompt used for the tweets of the X notewriter group. Missing in a run made before they existed. */
  xPrompt?: string;
  rows: ProbabilityRowResult[];
  costUsd: number;
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
  /** Missing in a run made before the probability eval. */
  probability?: ProbabilityEvalResult | null;
}
