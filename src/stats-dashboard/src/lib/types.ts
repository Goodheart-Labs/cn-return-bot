import type { PublicDumpRatings, ReferencedTweetData, TweetMediaItem } from "../../../dashboard-shared/types";
import type { ABTestSlotInfo } from "../../../dashboard-shared/abFilters";

export type CnStatus =
  | "CURRENTLY_RATED_HELPFUL"
  | "CURRENTLY_RATED_NOT_HELPFUL"
  | "NEEDS_MORE_RATINGS"
  | null;

export interface NoteTweetData {
  text: string | null;
  handle: string | null;
  media: TweetMediaItem[] | null;
  referenced_tweet_data: ReferencedTweetData | null;
  has_photo: boolean;
  has_video: boolean;
  media_count: number;
}

export interface NoteRecord {
  note_id: string;
  tweet_id: string;
  submitted_at: string;
  cn_status: CnStatus;
  view_count: number;
  helpful_count: number;
  not_helpful_count: number;
  rating_count: number;
  note_text: string;
  ab_test_picks: Record<string, string> | null;
  cost: number | null;
  tweet: NoteTweetData | null;
  public_dump_ratings: PublicDumpRatings | null;
  // The failure-mode tags the review dashboard recorded for this note. The value
  // is null when nobody has reviewed the note yet. An empty array means someone
  // reviewed it and found no flaws. Only reviewed notes count toward the
  // failure-mode denominator.
  failure_modes: string[] | null;
}

export interface PipelineRunAggregate {
  ab_test_picks_key: string;
  ab_test_picks: Record<string, string> | null;
  total_cost: number;
  run_count: number;
}

// Pipeline run outcome counts, with one row per UTC day and per full
// combination of A/B picks. The A/B comparison panel builds its candidate-share
// and "all runs" denominators from these rows. Splitting them by day is what
// lets the panel scope a comparison to the last N days. Each row is keyed by the
// complete ab_test_picks dict, with missing tests filled in by resolvePicks. The
// client filters the rows by date, projects them onto the tests it is splitting
// by, and sums them.
export interface AbOutcomeAggregate {
  date: string;                              // The created_at day in UTC, as YYYY-MM-DD.
  ab_test_picks_key: string;
  ab_test_picks: Record<string, string> | null;
  total: number; // Runs that have finished. A run still in progress is not counted.
  candidate: number; // Runs whose outcome is "candidate" or "submitted".
  submitted: number; // Runs whose outcome is "submitted".
  cost: number; // LLM cost in US dollars, summed over finished runs. A null cost counts as zero.
}

// A per-day rollup of pipeline_runs. The dashboard uses it to work out how many
// runs in each chart bucket never became a submitted note. Rolling the runs up
// this way means the snapshot does not have to carry every individual run row.
export interface PipelineRunDayBucket {
  date: string;                              // The created_at day in UTC, as YYYY-MM-DD.
  ab_test_picks: Record<string, string> | null;
  total_count: number;
  submitted_count: number;
}

// One row per UTC day. It splits the Community Notes that X's public dump lists
// as currently rated helpful by who wrote them. To get the number written by
// humans, subtract helpful_ours and helpful_other_ai from helpful_total.
export interface DailyOriginCount {
  day: string;                               // The note's createdAtMillis as a UTC day, as YYYY-MM-DD.
  helpful_total: number;
  helpful_ours: number;
  helpful_other_ai: number;                  // The nine other AI notewriters with the most helpful notes.
}

export interface StatsSnapshot {
  generated_at: string;
  notes: NoteRecord[];
  pipeline_run_aggregates: PipelineRunAggregate[];
  ab_outcome_aggregates: AbOutcomeAggregate[];
  pipeline_runs_by_day: PipelineRunDayBucket[];
  ab_test_slots: ABTestSlotInfo[];
  daily_note_origin_counts: DailyOriginCount[];
}

export type ChartGranularity = "daily" | "weekly";
export type ChartMode = "absolute" | "posted" | "ratio" | "share";
export type NoteSort = "latest_helpful" | "most_views_helpful" | "latest_unhelpful";
