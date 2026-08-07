// The single item type NoteCard renders. It covers production items and
// dataset-run items alike.
export interface ReviewItem {
  id: string;
  source: "production" | "dataset_run";
  tweetId: string;
  tweetText?: string;
  tweetHandle?: string;
  hasPhoto?: boolean;
  hasVideo?: boolean;
  mediaCount?: number;
  // The raw media arrays from X's API, as stored on the tweets table. We render
  // images and videos straight from these, instead of going through the old
  // parser for the log shape. Every entry carries at least a `type`, which is
  // "photo", "video" or "animated_gif".
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

  // Notes to compare ours against. For a production item these are the competing
  // notes on the same tweet. For a dataset run it is the ground-truth note.
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

  // A tag saying how far ahead of us the first helpful competitor note was. It is
  // computed while building the item and is never stored.
  competitorLeadTag?: string;

  // The fact-check topic this item was sighted under. It is the fine-grained
  // topic_id from misinfo_monitoring_sightings, plus the review set derived from
  // it. Both stay undefined on a regular note that has no sighting.
  topic?: string;
  topicSet?: import("../../../dashboard-shared/topicSets").TopicSet;

  // A note the bot wrote but never submitted, because the daily cap was full or a
  // pre-submit check failed. We recover it from its pipeline_run. The card marks
  // it as a draft. Such notes are hidden by default, because both draft pills,
  // filtered_no_slot and draft_check_failed, start switched off.
  isDraft?: boolean;

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
  highValue?: boolean;
}

// The failure types a production item can carry. Most of them come from the
// note's Community Notes status. The rest describe notes we never submitted, and
// notes someone else wrote on a tweet we passed on.
export type ProductionFailureType =
  | "rated_helpful"
  | "rated_unhelpful"
  | "lost_to_competitor"
  | "missed_opportunity"
  | "needs_more_ratings"
  | "underwater"
  | "filtered_low_eval_score"
  | "filtered_no_slot"
  | "draft_check_failed";

// The version-2 categories for dataset runs. They are produced by
// categorizeRowV2 in evaluateResults.ts.
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
  // The topic-set filter for misinformation monitoring. The sets are AI, animal
  // welfare, effective altruism and politics. An empty set means no narrowing by
  // topic, so everything shows. It combines with the other filters using AND.
  topicSets: Set<string>;
  // When this is on, the list shows the notes starred as high value, over all
  // time. The other filters still narrow within that set. Switching the star on
  // resets them so they restrict nothing. Seen goes back to "all", and the pills
  // and tags are cleared. Narrowing is then something the reviewer opts into, and
  // it is always visible in the filter bar. Nothing is overridden behind the
  // interface.
  highValueOnly: boolean;
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
  rated_helpful: { label: "Rated Helpful", defaultOn: true, production: true, datasetRun: false, color: "bg-green-100 text-green-800" },
  rated_unhelpful: { label: "Rated Unhelpful", defaultOn: true, production: true, datasetRun: false, color: "bg-red-100 text-red-800" },
  lost_to_competitor: { label: "Lost to competitor", defaultOn: false, production: true, datasetRun: false, color: "bg-orange-100 text-orange-800" },
  missed_opportunity: { label: "Missed opportunity", defaultOn: false, production: true, datasetRun: false, color: "bg-yellow-100 text-yellow-800" },
  needs_more_ratings: { label: "Needs More Ratings", defaultOn: false, production: true, datasetRun: false, color: "bg-blue-100 text-blue-800" },
  // A note that Community Notes still calls NEEDS_MORE_RATINGS, but whose ratings
  // are already bad enough that it is unlikely to recover. isUnderwaterNote in
  // lib/data.ts holds the exact rule. It is still undecided, but it is sinking.
  // This type is split out of needs_more_ratings the same way lost_to_competitor
  // is, so the two pills never show the same note.
  underwater: { label: "Underwater", defaultOn: true, production: true, datasetRun: false, color: "bg-indigo-100 text-indigo-800" },
  filtered_low_eval_score: { label: "Filtered (low eval score)", defaultOn: false, production: true, datasetRun: false, color: "bg-teal-100 text-teal-800" },
  // Notes the bot wrote but never submitted, split by the reason. Either the
  // daily cap was full, so a perfectly good note lost its slot, or a pre-submit
  // check failed. Both types are off by default. You filter them in when you want
  // to look at the drafts.
  filtered_no_slot: { label: "Filtered (no posting slots)", defaultOn: false, production: true, datasetRun: false, color: "bg-slate-100 text-slate-600" },
  draft_check_failed: { label: "Draft (check failed)", defaultOn: false, production: true, datasetRun: false, color: "bg-stone-100 text-stone-600" },

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

// The version-2 category strings that are already valid FailureType values.
const V2_CATEGORIES: Set<string> = new Set([
  "nw_success", "nw_published_directional", "nw_published_bad",
  "nw_miss_judge_killed_good", "nw_miss_judge_killed_bad",
  "nw_miss_verifier_killed_good", "nw_miss_verifier_killed_bad",
  "nw_miss_writer_abstained", "nw_miss_search_exhausted", "nw_miss_satire_killed",
  "nnw_correct_writer_abstained", "nnw_correct_judge_rejected",
  "nnw_correct_verifier_rejected", "nnw_correct_search_exhausted", "nnw_correct_satire_rejected",
  "nnw_fp_harmless", "nnw_fp_published", "nnw_eval_disagrees",
]);

// Maps the `result` column written by the AI judge onto a dashboard failure type.
// It handles the version-1 labels, such as "correct" and "missed", as well as the
// version-2 category strings.
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

export function defaultFilters(source: "production" | "dataset_run"): FilterState {
  const failureTypes = new Set<FailureType>();
  for (const [ft, cfg] of Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, FailureTypeConfig][]) {
    if (cfg.defaultOn && (source === "production" ? cfg.production : cfg.datasetRun)) {
      failureTypes.add(ft);
    }
  }
  // Default to "Unseen" so you work through the notes you haven't reviewed yet.
  return { seen: "unseen", failureTypes, failureModes: new Set(), topicSets: new Set(), highValueOnly: false };
}
