// Unified item type rendered by NoteCard — works for both production and dataset run items
export interface ReviewItem {
  id: string;
  source: "production" | "dataset_run";
  tweetId: string;
  tweetText?: string;
  tweetHandle?: string;

  // Our note
  noteId?: string;
  noteText?: string;
  sourceUrl?: string;
  status?: string;
  coreStatus?: string;
  viewCount?: number;
  ratingCount?: number;
  helpfulCount?: number;
  notHelpfulCount?: number;

  // Dates
  createdAt?: string;

  // Pipeline info
  outcome?: string;
  outcomeReason?: string;
  logs?: Record<string, unknown>;

  // Comparison notes (competing notes for production, ground truth for dataset runs)
  comparisonNotes?: ComparisonNote[];

  // Dataset run specific
  result?: string;
  groundTruthNote?: string;
  needsNote?: string;
  evaluationScore?: number;

  // Annotation state
  annotation?: Annotation;

  // For filter categorization
  failureType: FailureType;
}

export interface ComparisonNote {
  noteId: string;
  noteText?: string;
  status?: string;
  coreStatus?: string;
  helpfulCount?: number;
  notHelpfulCount?: number;
  authorId?: string;
}

export interface Annotation {
  id?: string;
  seen: boolean;
  failureModes: string[];
  comment?: string;
}

export type FailureType =
  | "rated_helpful"
  | "rated_unhelpful"
  | "lost_to_competitor"
  | "missed_opportunity"
  | "false_positive"
  | "correct_rejection"
  | "needs_more_ratings"
  | "uncategorized";

export interface FilterState {
  seen: "all" | "seen" | "unseen";
  failureTypes: Set<FailureType>;
  failureModes: Set<string>;
}

export const FAILURE_TYPE_CONFIG: Record<
  FailureType,
  { label: string; defaultOn: boolean; production: boolean; datasetRun: boolean; color: string }
> = {
  rated_helpful: { label: "Rated Helpful", defaultOn: false, production: true, datasetRun: true, color: "bg-green-100 text-green-800" },
  rated_unhelpful: { label: "Rated Unhelpful", defaultOn: true, production: true, datasetRun: true, color: "bg-red-100 text-red-800" },
  lost_to_competitor: { label: "Lost to competitor", defaultOn: true, production: true, datasetRun: false, color: "bg-orange-100 text-orange-800" },
  missed_opportunity: { label: "Missed opportunity", defaultOn: true, production: true, datasetRun: true, color: "bg-yellow-100 text-yellow-800" },
  false_positive: { label: "False positive", defaultOn: true, production: false, datasetRun: true, color: "bg-pink-100 text-pink-800" },
  correct_rejection: { label: "Correct rejection", defaultOn: false, production: false, datasetRun: true, color: "bg-gray-100 text-gray-600" },
  needs_more_ratings: { label: "Needs More Ratings", defaultOn: false, production: true, datasetRun: false, color: "bg-blue-100 text-blue-800" },
  uncategorized: { label: "Uncategorized", defaultOn: false, production: true, datasetRun: true, color: "bg-gray-100 text-gray-500" },
};

// Derive failure type from the fields actually present in pipeline CSV output
export function deriveFailureType(row: {
  outcome?: string | null;
  needsNote?: string | null;
  noteStatus?: string | null;
}): FailureType {
  const outcome = row.outcome ?? "";
  const needsNote = (row.needsNote ?? "").trim().toLowerCase();
  const proposed = row.noteStatus === "CORRECTION WITH TRUSTWORTHY CITATION";

  if (outcome.startsWith("error")) return "uncategorized";

  if (needsNote === "yes") {
    if (!proposed && !outcome.startsWith("candidate")) return "missed_opportunity";
    // Note was proposed for a noteworthy tweet — assume correct unless marked otherwise
    return "rated_helpful";
  }

  if (needsNote === "no") {
    if (proposed || outcome.startsWith("candidate")) return "false_positive";
    return "correct_rejection";
  }

  // No ground truth
  return "uncategorized";
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
