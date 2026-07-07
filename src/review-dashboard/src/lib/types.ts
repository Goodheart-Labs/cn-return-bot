// Unified item type rendered by NoteCard — works for both production and dataset run items
export interface ReviewItem {
  id: string;
  source: "production" | "dataset_run";
  tweetId: string;
  tweetText?: string;
  tweetHandle?: string;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  mediaCount?: number;
  // Raw X-API media arrays from the tweets table — used to render images/videos
  // without going through the legacy log-shape parser. Each entry has at least
  // {type: "photo"|"video"|"animated_gif", url}.
  tweetMedia?: Array<{ type: string; url?: string; preview_image_url?: string; [k: string]: unknown }>;
  referencedTweetData?: { text?: string; media?: Array<{ type: string; url?: string; [k: string]: unknown }> };

  // Our note
  noteId?: string;
  noteText?: string;
  status?: string;
  coreStatus?: string;
  viewCount?: number;
  ratingCount?: number;
  helpfulCount?: number;
  notHelpfulCount?: number;
  publicDumpRatings?: import("../../../dashboard-shared/types").PublicDumpRatings;

  // Dates
  createdAt?: string;

  // Pipeline info
  outcome?: string;
  outcomeReason?: string;
  logs?: Record<string, unknown>;
  pipelineRunId?: string;
  botId?: string;
  abTestPicks?: Record<string, string>;

  // Comparison notes (competing notes for production, ground truth for dataset runs)
  comparisonNotes?: ComparisonNote[];

  // Dataset run specific
  result?: string;
  groundTruthNote?: string;
  needsNote?: string;
  evaluationScore?: number;
  judgeGuidance?: string;
  originalNoteText?: string;
  failureReason?: string;

  // Annotation state
  annotation?: Annotation;

  // Auto-computed competitor lead time tag (not persisted)
  competitorLeadTag?: string;

  // For filter categorization
  failureType: FailureType;
}

export interface ComparisonNote {
  noteId: string;
  noteText?: string;
  status?: string;
  authorId?: string;
  createdAtMillis?: number;
}

export interface Annotation {
  id?: string;
  seen: boolean;
  failureModes: string[];
  comment?: string;
}

// Production failure types (derived from CN status)
export type ProductionFailureType =
  | "rated_helpful"
  | "rated_unhelpful"
  | "lost_to_competitor"
  | "missed_opportunity"
  | "needs_more_ratings"
  | "underwater"
  | "filtered_low_eval_score";

// V2 dataset run categories (from evaluateResults categorizeRowV2)
export type DatasetCategoryV2 =
  | "nw_success"
  | "nw_published_directional"
  | "nw_published_bad"
  | "nw_miss_judge_killed_good"
  | "nw_miss_judge_killed_bad"
  | "nw_miss_verifier_killed_good"
  | "nw_miss_verifier_killed_bad"
  | "nw_miss_writer_abstained"
  | "nw_miss_search_exhausted"
  | "nw_miss_satire_killed"
  | "nnw_correct_writer_abstained"
  | "nnw_correct_judge_rejected"
  | "nnw_correct_verifier_rejected"
  | "nnw_correct_search_exhausted"
  | "nnw_correct_satire_rejected"
  | "nnw_fp_harmless"
  | "nnw_fp_published"
  | "nnw_eval_disagrees";

export type FailureType = ProductionFailureType | DatasetCategoryV2 | "uncategorized";

export interface FilterState {
  seen: "all" | "seen" | "unseen";
  failureTypes: Set<FailureType>;
  failureModes: Set<string>;
}

export interface FailureTypeConfig {
  label: string;
  defaultOn: boolean;
  production: boolean;
  datasetRun: boolean;
  color: string;
  group?: "noteworthy" | "non_noteworthy";
}

export const FAILURE_TYPE_CONFIG: Record<FailureType, FailureTypeConfig> = {
  // --- Production types ---
  rated_helpful: { label: "Rated Helpful", defaultOn: false, production: true, datasetRun: false, color: "bg-green-100 text-green-800" },
  rated_unhelpful: { label: "Rated Unhelpful", defaultOn: true, production: true, datasetRun: false, color: "bg-red-100 text-red-800" },
  lost_to_competitor: { label: "Lost to competitor", defaultOn: false, production: true, datasetRun: false, color: "bg-orange-100 text-orange-800" },
  missed_opportunity: { label: "Missed opportunity", defaultOn: false, production: true, datasetRun: false, color: "bg-yellow-100 text-yellow-800" },
  needs_more_ratings: { label: "Needs More Ratings", defaultOn: false, production: true, datasetRun: false, color: "bg-blue-100 text-blue-800" },
  // NEEDS_MORE_RATINGS notes whose rating counts run net negative (not-helpful >
  // helpful) — still undecided by CN, but sinking. Split out of needs_more_ratings
  // the same way lost_to_competitor is, so the two pills stay disjoint.
  underwater: { label: "Underwater", defaultOn: false, production: true, datasetRun: false, color: "bg-indigo-100 text-indigo-800" },
  filtered_low_eval_score: { label: "Filtered (low eval score)", defaultOn: false, production: true, datasetRun: false, color: "bg-teal-100 text-teal-800" },

  // --- V2 dataset categories: noteworthy ---
  nw_success:                   { label: "Success",              defaultOn: true,  production: false, datasetRun: true, color: "bg-green-100 text-green-800",  group: "noteworthy" },
  nw_published_directional:     { label: "Published directional",defaultOn: true,  production: false, datasetRun: true, color: "bg-lime-100 text-lime-800",    group: "noteworthy" },
  nw_published_bad:             { label: "Published bad",        defaultOn: true,  production: false, datasetRun: true, color: "bg-red-100 text-red-800",      group: "noteworthy" },
  nw_miss_judge_killed_good:    { label: "Judge killed good",    defaultOn: true,  production: false, datasetRun: true, color: "bg-orange-100 text-orange-800", group: "noteworthy" },
  nw_miss_judge_killed_bad:     { label: "Judge killed bad",     defaultOn: false, production: false, datasetRun: true, color: "bg-yellow-100 text-yellow-800", group: "noteworthy" },
  nw_miss_verifier_killed_good: { label: "Verifier killed good", defaultOn: true,  production: false, datasetRun: true, color: "bg-orange-100 text-orange-800", group: "noteworthy" },
  nw_miss_verifier_killed_bad:  { label: "Verifier killed bad",  defaultOn: false, production: false, datasetRun: true, color: "bg-yellow-100 text-yellow-800", group: "noteworthy" },
  nw_miss_writer_abstained:     { label: "Writer abstained",     defaultOn: true,  production: false, datasetRun: true, color: "bg-red-100 text-red-800",      group: "noteworthy" },
  nw_miss_search_exhausted:     { label: "Search exhausted",     defaultOn: true,  production: false, datasetRun: true, color: "bg-red-100 text-red-800",      group: "noteworthy" },
  nw_miss_satire_killed:        { label: "Satire killed good",   defaultOn: true,  production: false, datasetRun: true, color: "bg-orange-100 text-orange-800", group: "noteworthy" },

  // --- V2 dataset categories: non-noteworthy ---
  nnw_correct_writer_abstained:   { label: "Writer abstained",   defaultOn: false, production: false, datasetRun: true, color: "bg-gray-100 text-gray-600",   group: "non_noteworthy" },
  nnw_correct_judge_rejected:     { label: "Judge rejected",     defaultOn: false, production: false, datasetRun: true, color: "bg-gray-100 text-gray-600",   group: "non_noteworthy" },
  nnw_correct_verifier_rejected:  { label: "Verifier rejected",  defaultOn: false, production: false, datasetRun: true, color: "bg-gray-100 text-gray-600",   group: "non_noteworthy" },
  nnw_correct_search_exhausted:   { label: "Search exhausted",   defaultOn: false, production: false, datasetRun: true, color: "bg-gray-100 text-gray-600",   group: "non_noteworthy" },
  nnw_correct_satire_rejected:    { label: "Satire rejected",    defaultOn: false, production: false, datasetRun: true, color: "bg-gray-100 text-gray-600",   group: "non_noteworthy" },
  nnw_fp_harmless:                { label: "FP harmless",        defaultOn: true,  production: false, datasetRun: true, color: "bg-amber-100 text-amber-800", group: "non_noteworthy" },
  nnw_fp_published:               { label: "FP published",       defaultOn: true,  production: false, datasetRun: true, color: "bg-pink-100 text-pink-800",   group: "non_noteworthy" },
  nnw_eval_disagrees:             { label: "Eval disagrees",     defaultOn: true,  production: false, datasetRun: true, color: "bg-purple-100 text-purple-800", group: "non_noteworthy" },

  // --- Shared ---
  uncategorized: { label: "Uncategorized", defaultOn: false, production: true, datasetRun: true, color: "bg-gray-100 text-gray-500" },
};

// V2 category strings that map directly to FailureType
const V2_CATEGORIES: Set<string> = new Set([
  "nw_success", "nw_published_directional", "nw_published_bad",
  "nw_miss_judge_killed_good", "nw_miss_judge_killed_bad",
  "nw_miss_verifier_killed_good", "nw_miss_verifier_killed_bad",
  "nw_miss_writer_abstained", "nw_miss_search_exhausted", "nw_miss_satire_killed",
  "nnw_correct_writer_abstained", "nnw_correct_judge_rejected",
  "nnw_correct_verifier_rejected", "nnw_correct_search_exhausted", "nnw_correct_satire_rejected",
  "nnw_fp_harmless", "nnw_fp_published", "nnw_eval_disagrees",
]);

// Map the `result` column from the AI judge to dashboard failure types.
// Handles both V1 labels ("correct", "missed", ...) and V2 category strings.
export function resultToFailureType(result: string | undefined | null): FailureType {
  if (!result) return "uncategorized";
  if (V2_CATEGORIES.has(result)) return result as DatasetCategoryV2;
  switch (result) {
    case "correct": return "nw_success";
    case "incorrect": return "nw_published_bad";
    case "missed": return "nw_miss_writer_abstained";
    case "false positive": return "nnw_fp_published";
    case "correct_rejection": return "nnw_correct_judge_rejected";
    case "error": return "uncategorized";
    default: return "uncategorized";
  }
}

export interface DatasetOption {
  type: "production" | "dataset_run";
  id?: string;
  name: string;
}

export interface UploadInfo {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
}

export interface FailureModeInfo {
  name: string;
  fixed: boolean;
}
